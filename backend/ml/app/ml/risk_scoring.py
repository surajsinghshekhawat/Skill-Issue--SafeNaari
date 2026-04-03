"""
Risk Scoring Engine
Calculates risk scores (0-5) for locations based on incident data
"""

import math
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, List, Any
from app.config import settings
from app.db.storage import get_incidents
from app.utils.geospatial import calculate_distance_haversine


def calculate_recency_weight(days_ago: float) -> float:
    """
    Calculate recency weight using exponential decay
    
    Args:
        days_ago: Number of days since incident
        
    Returns:
        Weight between 0 and 1
    """
    # Exponential decay: weight = e^(-days_ago / decay_days)
    # decay_days is configurable so the system can be calibrated:
    # - too small  -> only very recent incidents matter (everything becomes "yellow/low")
    # - too large  -> very old incidents keep affecting risk for too long
    decay_days = float(getattr(settings, "recency_decay_days", 30.0))
    decay_days = max(1.0, decay_days)  # safety
    return math.exp(-days_ago / decay_days)


def calculate_time_of_day_factor(local_hour: int) -> float:
    """
    Calculate time-of-day risk factor based on LOCAL hour (0-23)
    Higher risk at night (9PM-4AM), lower during day (10AM-6PM)
    
    Args:
        local_hour: LOCAL hour (0-23) from user's timezone, not UTC
        
    Returns:
        Time factor between 0.0 (safe hours) and 1.0 (risky hours)
    """
    hour = local_hour
    
    # High risk: 9 PM - 4 AM (21:00 - 04:00)
    if 21 <= hour or hour < 4:
        return 0.9  # High risk at night
    
    # Medium-high risk: 6 PM - 9 PM (18:00 - 21:00)
    elif 18 <= hour < 21:
        return 0.7  # Evening risk
    
    # Medium risk: 4 AM - 8 AM (04:00 - 08:00)
    elif 4 <= hour < 8:
        return 0.6  # Early morning
    
    # Lower risk: 8 AM - 6 PM (08:00 - 18:00)
    else:
        return 0.3  # Daytime is safer


def _circular_hour_distance(a: int, b: int) -> int:
    """Circular distance on a 24-hour clock (0..23)."""
    d = abs(int(a) - int(b)) % 24
    return min(d, 24 - d)


def _time_of_day_similarity_weight(current_local_hour: int, incident_local_hour: int) -> float:
    """
    Weight in [0,1] based on how close the incident hour-of-day is to the current hour-of-day.
    This enables true time-dependent hotspots (same location differs by viewing time).
    """
    sigma = float(getattr(settings, "time_of_day_sigma_hours", 3.0))
    sigma = max(0.25, sigma)
    floor = float(getattr(settings, "time_of_day_min_weight", 0.05))
    floor = max(0.0, min(1.0, floor))

    dh = float(_circular_hour_distance(current_local_hour, incident_local_hour))
    w = math.exp(-(dh * dh) / (2.0 * sigma * sigma))
    return max(floor, min(1.0, w))


def _incident_hour_local(incident: Dict[str, Any]) -> Optional[int]:
    """
    Best-effort local hour-of-day for an incident.
    Preference order:
    1) incident["incident_local_hour"] (precomputed at ingest)
    2) incident["timestamp"] adjusted by incident["timezone_offset_minutes"]
    3) fallback to incident timestamp hour (may be UTC if not adjusted)
    """
    try:
        h = incident.get("incident_local_hour", None)
        if h is not None:
            h_int = int(h)
            if 0 <= h_int <= 23:
                return h_int
    except Exception:
        pass

    tz_off = incident.get("timezone_offset_minutes", None)

    ts = incident.get("timestamp")
    if isinstance(ts, datetime):
        ts_dt = ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)
    elif isinstance(ts, str):
        try:
            ts_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            return None
    else:
        return None

    if tz_off is not None:
        try:
            return int((ts_dt + timedelta(minutes=int(tz_off))).hour)
        except Exception:
            return int(ts_dt.hour)

    return int(ts_dt.hour)


def _verification_weight(incident: Dict[str, Any]) -> float:
    """
    Moderation-aware weighting.

    Policy:
    - verified == True           => full weight (1.0)
    - verified == False + moderation_reason set => rejected => zero weight (0.0)
    - verified == False + no moderation_reason  => pending => reduced weight
    """
    try:
        if bool(incident.get("verified", False)) is True:
            return 1.0
        # If the incident was explicitly rejected, moderation_reason is typically set.
        if incident.get("moderation_reason", None) not in (None, "", False):
            return 0.0
        return 0.35
    except Exception:
        return 0.35


def _calculate_risk_score_from_incidents(
    lat: float,
    lng: float,
    incidents: List[Dict[str, Any]],
    query_timestamp: Optional[datetime] = None,
    local_hour: Optional[int] = None,
    radius_meters: float = 1000.0,
) -> Dict:
    """
    Core risk scoring logic that operates on a provided incident list.
    This avoids repeated DB queries when callers already fetched incidents.
    """
    now = query_timestamp if query_timestamp else datetime.now(timezone.utc)
    query_local_hour = local_hour if local_hour is not None else now.hour
    current_time_factor = calculate_time_of_day_factor(query_local_hour)

    if not incidents:
        base_risk = current_time_factor * 1.5
        return {
            "risk_score": round(base_risk, 2),
            "risk_level": "safe" if base_risk < 2.0 else "medium",
            "factors": {
                "incident_density": 0.0,
                "recency": 0.0,
                "severity": 0.0,
                "time_pattern": round(current_time_factor, 3),
                "current_time_factor": round(current_time_factor, 3),
                "raw_incident_count": 0,
                "effective_incident_count": 0.0,
            },
        }

    weighted_severity = 0.0
    # Distance+time weighted average recency (kept in [0,1])
    weighted_recency_numer = 0.0
    weighted_recency_denom = 0.0
    total_weight = 0.0
    effective_incident_count = 0.0

    # Pre-filter to within radius_meters (matches original PostGIS query semantics)
    nearby_incidents: List[Dict[str, Any]] = []
    for inc in incidents:
        try:
            d_m = calculate_distance_haversine(lat, lng, inc["latitude"], inc["longitude"])
            if d_m <= radius_meters:
                nearby_incidents.append(inc)
        except Exception:
            continue

    if not nearby_incidents:
        # If nothing is within radius, fall back to time-only base risk
        base_risk = current_time_factor * 1.5
        return {
            "risk_score": round(base_risk, 2),
            "risk_level": "safe" if base_risk < 2.0 else "medium",
            "factors": {
                "incident_density": 0.0,
                "recency": 0.0,
                "severity": 0.0,
                "time_pattern": round(current_time_factor, 3),
                "current_time_factor": round(current_time_factor, 3),
                "raw_incident_count": 0,
                "effective_incident_count": 0.0,
            },
        }

    # Apply moderation filtering/weighting:
    # - Rejected incidents contribute 0.0 (ignored)
    # - Pending incidents contribute reduced weight
    active_incidents: List[Dict[str, Any]] = []
    for inc in nearby_incidents:
        vw = _verification_weight(inc)
        if vw <= 0.0:
            continue
        active_incidents.append(inc)

    if not active_incidents:
        # All nearby incidents were rejected => treat as no-incidents for scoring.
        base_risk = current_time_factor * 1.5
        return {
            "risk_score": round(base_risk, 2),
            "risk_level": "safe" if base_risk < 2.0 else "medium",
            "factors": {
                "incident_density": 0.0,
                "recency": 0.0,
                "severity": 0.0,
                "time_pattern": round(current_time_factor, 3),
                "current_time_factor": round(current_time_factor, 3),
                "raw_incident_count": 0,
                "effective_incident_count": 0.0,
                "verified_incident_count": 0,
                "pending_incident_count": 0,
                "rejected_incident_count": len(nearby_incidents),
            },
        }

    verified_count = 0
    pending_count = 0
    rejected_count = len(nearby_incidents) - len(active_incidents)

    for incident in active_incidents:
        vw = _verification_weight(incident)
        if vw >= 0.999:
            verified_count += 1
        else:
            pending_count += 1

        distance_meters = calculate_distance_haversine(
            lat, lng, incident["latitude"], incident["longitude"]
        )
        distance_weight = math.exp(-distance_meters / 111.0)

        # Timestamp parsing / normalization (timezone-aware)
        incident_timestamp = incident["timestamp"]
        if isinstance(incident_timestamp, datetime):
            if incident_timestamp.tzinfo is None:
                incident_timestamp = incident_timestamp.replace(tzinfo=timezone.utc)
        elif isinstance(incident_timestamp, str):
            incident_timestamp = datetime.fromisoformat(
                incident_timestamp.replace("Z", "+00:00")
            )
        else:
            continue

        days_ago = (now - incident_timestamp).total_seconds() / 86400
        recency_weight = calculate_recency_weight(days_ago)

        # Time-of-day similarity: incidents that occurred around the current local time-of-day
        # contribute more than incidents that happened at very different hours.
        inc_hour_local = _incident_hour_local(incident)
        if inc_hour_local is None:
            inc_hour_local = query_local_hour
        time_weight = _time_of_day_similarity_weight(query_local_hour, inc_hour_local)

        # Moderation-aware multiplier
        weight = distance_weight * recency_weight * time_weight * vw
        effective_incident_count += recency_weight * time_weight * vw

        weighted_severity += incident["severity"] * weight
        weighted_recency_numer += recency_weight * distance_weight * time_weight * vw
        weighted_recency_denom += distance_weight * time_weight * vw
        total_weight += weight

    # Density (recency-aware effective count) with calibrated max
    max_expected = max(1.0, float(getattr(settings, "max_expected_effective_incidents", 10.0)))
    incident_density = (
        math.log(effective_incident_count + 1) / math.log(max_expected + 1)
        if effective_incident_count > 0
        else 0.0
    )
    incident_density = max(0.0, min(1.0, incident_density))

    avg_recency = (
        (weighted_recency_numer / weighted_recency_denom) if weighted_recency_denom > 0 else 0.0
    )
    avg_severity = weighted_severity / total_weight if total_weight > 0 else 0.0
    avg_severity = avg_severity / 5.0

    # Time window matching (historical pattern near this location)
    night_window = [21, 22, 23, 0, 1, 2, 3, 4]
    evening_window = [18, 19, 20]
    afternoon_window = [12, 13, 14, 15, 16, 17]
    morning_window = [6, 7, 8, 9, 10, 11]

    night_incidents = 0
    evening_incidents = 0
    afternoon_incidents = 0
    morning_incidents = 0

    for incident in active_incidents:
        incident_hour = _incident_hour_local(incident)
        if incident_hour is None:
            continue

        if incident_hour in night_window:
            night_incidents += 1
        elif incident_hour in evening_window:
            evening_incidents += 1
        elif incident_hour in afternoon_window:
            afternoon_incidents += 1
        elif incident_hour in morning_window:
            morning_incidents += 1

    pattern_counts = {
        "night": night_incidents,
        "evening": evening_incidents,
        "afternoon": afternoon_incidents,
        "morning": morning_incidents,
    }
    total_incidents_by_time = sum(pattern_counts.values())

    if total_incidents_by_time > 0:
        night_ratio = night_incidents / total_incidents_by_time
        evening_ratio = evening_incidents / total_incidents_by_time
        afternoon_ratio = afternoon_incidents / total_incidents_by_time
        morning_ratio = morning_incidents / total_incidents_by_time

        dominant_pattern = max(pattern_counts, key=pattern_counts.get)

        current_hour_matches_pattern = False
        match_strength = 0.0

        if query_local_hour in night_window and dominant_pattern == "night":
            current_hour_matches_pattern = True
            match_strength = night_ratio
        elif query_local_hour in evening_window and dominant_pattern == "evening":
            current_hour_matches_pattern = True
            match_strength = evening_ratio
        elif query_local_hour in afternoon_window and dominant_pattern == "afternoon":
            current_hour_matches_pattern = True
            match_strength = afternoon_ratio
        elif query_local_hour in morning_window and dominant_pattern == "morning":
            current_hour_matches_pattern = True
            match_strength = morning_ratio

        location_time_pattern = current_time_factor
        if current_hour_matches_pattern and match_strength > 0.5:
            location_time_pattern = 0.9 + (match_strength * 0.1)
        elif current_hour_matches_pattern and match_strength > 0.3:
            location_time_pattern = 0.7 + (match_strength * 0.2)
        elif current_hour_matches_pattern:
            location_time_pattern = 0.5 + (match_strength * 0.2)
        else:
            location_time_pattern = current_time_factor * 0.6

        time_pattern = (location_time_pattern * 0.7) + (current_time_factor * 0.3)
    else:
        time_pattern = current_time_factor

    risk_score = (
        settings.weight_incident_density * incident_density
        + settings.weight_recency * avg_recency
        + settings.weight_severity * avg_severity
        + settings.weight_time_pattern * time_pattern
    ) * 5.0
    risk_score = max(0.0, min(5.0, risk_score))

    if risk_score <= 1.0:
        risk_level = "very_safe"
    elif risk_score <= 2.0:
        risk_level = "safe"
    elif risk_score <= 3.0:
        risk_level = "medium"
    elif risk_score <= 4.0:
        risk_level = "high"
    else:
        risk_level = "very_high"

    return {
        "risk_score": round(risk_score, 2),
        "risk_level": risk_level,
        "factors": {
            "incident_density": round(incident_density, 3),
            "recency": round(avg_recency, 3),
            "severity": round(avg_severity, 3),
            "time_pattern": round(time_pattern, 3),
            "current_time_factor": round(current_time_factor, 3),
            "raw_incident_count": len(active_incidents),
            "effective_incident_count": round(effective_incident_count, 3),
            "verified_incident_count": verified_count,
            "pending_incident_count": pending_count,
            "rejected_incident_count": rejected_count,
        },
        "calculated_at": now.isoformat(),
    }


def calculate_risk_score(lat: float, lng: float, query_timestamp: Optional[datetime] = None, local_hour: Optional[int] = None) -> Dict:
    """
    Calculate risk score for a specific location
    NOW SUPPORTS TIME-BASED RISK CALCULATION
    
    Args:
        lat: Latitude
        lng: Longitude
        query_timestamp: Current time for time-based risk (default: now)
        
    Returns:
        Dictionary with risk_score, risk_level, factors, etc.
    """
    from app.db.storage import get_incidents_in_radius
    incidents = get_incidents_in_radius(lat, lng, 1000)
    return _calculate_risk_score_from_incidents(
        lat=lat,
        lng=lng,
        incidents=incidents,
        query_timestamp=query_timestamp,
        local_hour=local_hour,
        radius_meters=1000.0,
    )

