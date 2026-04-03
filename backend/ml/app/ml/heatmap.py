"""
Heatmap Generator - Grid-based risk visualization
NOW SUPPORTS TIME-BASED RISK CALCULATION
"""

import math
from typing import Dict, Optional
from datetime import datetime, timezone
from app.ml.risk_scoring import calculate_risk_score, _calculate_risk_score_from_incidents
from app.ml.clustering import get_clusters
from app.utils.geospatial import calculate_distance_haversine
from app.utils.land_mask import is_point_allowed


def meters_to_degrees(meters: float) -> float:
    """Convert meters to degrees (approximate)"""
    return meters / 111000.0


def generate_heatmap(
    center_lat: float,
    center_lng: float,
    radius_meters: int,
    grid_size_meters: int,
    query_timestamp: Optional[datetime] = None,  # UTC timestamp for logging
    local_hour: Optional[int] = None,  # LOCAL hour (0-23) for time-based risk
    include_clusters: bool = False,  # Admin-only: clusters are not needed for mobile heatmap UI
) -> Dict:
    """
    Generate heatmap data for an area
    
    Args:
        center_lat: Center latitude
        center_lng: Center longitude
        radius_meters: Radius in meters
        grid_size_meters: Size of each grid cell in meters
        
    Returns:
        Dictionary with heatmap data
    """
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        # Convert to degrees
        radius_degrees = meters_to_degrees(radius_meters)
        grid_size_degrees = meters_to_degrees(grid_size_meters)
        
        # Calculate grid bounds
        lat_min = center_lat - radius_degrees
        lat_max = center_lat + radius_degrees
        lng_min = center_lng - radius_degrees
        lng_max = center_lng + radius_degrees
        
        # Limit grid size to prevent excessive computation and timeout
        # For large radii, use a maximum number of cells to prevent timeout
        # Reduced from 10000 to 3000 to prevent timeout issues
        max_cells = 3000  # Maximum cells to generate (prevents timeout)
        estimated_cells = int((2 * radius_degrees / grid_size_degrees) ** 2)
        
        if estimated_cells > max_cells:
            # Adjust grid size to stay within limit
            # Increase grid size (larger cells) to reduce total cell count
            adjusted_grid_size = math.sqrt((2 * radius_degrees) ** 2 / max_cells)
            grid_size_degrees = max(grid_size_degrees, adjusted_grid_size)
            logger.warning(f"Grid too large ({estimated_cells} cells), adjusting grid_size to {grid_size_degrees:.6f} degrees (was {meters_to_degrees(grid_size_meters):.6f}) to prevent timeout")

        # Safety check: ensure bounds are valid (after any clipping)
        if lat_min >= lat_max or lng_min >= lng_max:
            logger.error(
                f"Invalid bounds after clipping: lat [{lat_min:.6f}, {lat_max:.6f}], "
                f"lng [{lng_min:.6f}, {lng_max:.6f}]"
            )
            # Use original bounds if clipping resulted in invalid bounds
            lat_min = center_lat - radius_degrees
            lat_max = center_lat + radius_degrees
            lng_min = center_lng - radius_degrees
            lng_max = center_lng + radius_degrees
            logger.warning(
                f"Using original bounds: lat [{lat_min:.6f}, {lat_max:.6f}], "
                f"lng [{lng_min:.6f}, {lng_max:.6f}]"
            )

        # Safety check: ensure grid_size is smaller than bounds range
        lat_range = lat_max - lat_min
        lng_range = lng_max - lng_min
        if grid_size_degrees >= lat_range or grid_size_degrees >= lng_range:
            logger.warning(
                f"Grid size ({grid_size_degrees:.6f}) is too large for bounds range "
                f"(lat: {lat_range:.6f}, lng: {lng_range:.6f}). Using smaller grid size."
            )
            grid_size_degrees = min(lat_range, lng_range) / 10  # 10% of smallest range
            logger.info(f"Adjusted grid_size to {grid_size_degrees:.6f} degrees")
        
        # OPTION B (performance + UX): generate cells ONLY where incidents exist.
        # This avoids computing thousands of "safe" grid cells and keeps the heatmap focused
        # on reported/incident regions.
        from app.db.storage import get_incidents_in_radius

        # Fetch incidents in view (for deciding which cells exist)
        incidents_in_view = get_incidents_in_radius(center_lat, center_lng, radius_meters)

        # Fetch a slightly larger radius for neighborhood context (so cell scoring near edges
        # still sees incidents within its 1km local neighborhood).
        incidents_context = get_incidents_in_radius(center_lat, center_lng, radius_meters + 1000)

        # Moderation-aware filtering:
        # - rejected incidents (verified=False with moderation_reason set) are excluded entirely
        def _is_rejected(inc: dict) -> bool:
            try:
                return (not bool(inc.get("verified", False))) and inc.get("moderation_reason", None) not in (None, "", False)
            except Exception:
                return False

        incidents_in_view = [i for i in incidents_in_view if not _is_rejected(i)]
        incidents_context = [i for i in incidents_context if not _is_rejected(i)]

        # Bin incidents into grid buckets (based on bounding box + grid size).
        # We keep two maps:
        # - view_bins: bins that have incidents within the requested view radius
        # - context_bins: bins that include a buffer for neighborhood scoring
        view_bins: Dict[tuple, list] = {}
        context_bins: Dict[tuple, list] = {}

        def _bin_key(lat_v: float, lng_v: float) -> tuple:
            i = int((lat_v - lat_min) / grid_size_degrees)
            j = int((lng_v - lng_min) / grid_size_degrees)
            return (i, j)

        for inc in incidents_context:
            try:
                k = _bin_key(float(inc["latitude"]), float(inc["longitude"]))
                context_bins.setdefault(k, []).append(inc)
            except Exception:
                continue

        for inc in incidents_in_view:
            try:
                k = _bin_key(float(inc["latitude"]), float(inc["longitude"]))
                view_bins.setdefault(k, []).append(inc)
            except Exception:
                continue

        # Score each bin that has at least one incident in view.
        # For each bin center, we compute risk using only incidents in nearby bins within ~1km.
        neighbor_range = int(math.ceil(1000.0 / max(1.0, float(grid_size_meters))))

        cells = []
        skipped_mask_cells = 0
        cell_count = 0

        logger.info(
            f"Incident-based heatmap: incidents_in_view={len(incidents_in_view)}, "
            f"incidents_context={len(incidents_context)}, active_bins={len(view_bins)}"
        )

        for (i, j), bin_incidents in view_bins.items():
            if cell_count >= max_cells:
                break

            # Use centroid of incidents in this bin for better alignment than grid center.
            lats = [float(x["latitude"]) for x in bin_incidents]
            lngs = [float(x["longitude"]) for x in bin_incidents]
            cell_lat = sum(lats) / len(lats)
            cell_lng = sum(lngs) / len(lngs)

            # Research-grade land/city masking: discard cells outside polygon boundary
            if not is_point_allowed(cell_lat, cell_lng):
                skipped_mask_cells += 1
                continue

            # Build neighborhood incident set from nearby bins
            neighborhood: list = []
            for di in range(-neighbor_range, neighbor_range + 1):
                for dj in range(-neighbor_range, neighbor_range + 1):
                    neighborhood.extend(context_bins.get((i + di, j + dj), []))

            # Filter neighborhood to within 1km of cell center (matches risk scoring semantics)
            nearby_for_cell: list = []
            for inc in neighborhood:
                try:
                    d_m = calculate_distance_haversine(
                        cell_lat, cell_lng, float(inc["latitude"]), float(inc["longitude"])
                    )
                    if d_m <= 1000.0:
                        nearby_for_cell.append(inc)
                except Exception:
                    continue

            try:
                risk_data = _calculate_risk_score_from_incidents(
                    lat=cell_lat,
                    lng=cell_lng,
                    incidents=nearby_for_cell,
                    query_timestamp=query_timestamp,
                    local_hour=local_hour,
                    radius_meters=1000.0,
                )
            except Exception as e:
                logger.error(f"Error calculating risk for incident-cell ({cell_lat}, {cell_lng}): {e}")
                risk_data = {"risk_score": 0.0, "risk_level": "very_safe"}

            # last incident timestamp in this bin (best-effort)
            last_incident = None
            try:
                ts_list = []
                for x in bin_incidents:
                    ts = x.get("timestamp")
                    ts_list.append(ts)
                # timestamps may be datetime or strings; keep as-is for now
                last_incident = max(ts_list) if ts_list else None
            except Exception:
                last_incident = None

            cells.append(
                {
                    "lat": cell_lat,
                    "lng": cell_lng,
                    "risk_score": risk_data.get("risk_score", 0.0),
                    "risk_level": risk_data.get("risk_level", "very_safe"),
                    "incident_count": len(bin_incidents),
                    "last_incident": last_incident,
                }
            )
            cell_count += 1

        logger.info(
            f"Generated {len(cells)} incident-based heatmap cells for area centered at ({center_lat}, {center_lng}). "
            f"Skipped {skipped_mask_cells} masked-out cells; capped at {max_cells}."
        )
        # No fallback center cell: when no incidents are in view, return empty cells.
        # A fallback at viewport center created a confusing "moving circle" that followed pan/zoom.

    except Exception as e:
        logger.error(f"Error generating heatmap: {e}", exc_info=True)
        # Return at least a minimal heatmap with center cell on error
        cells = [{
            "lat": center_lat,
            "lng": center_lng,
            "risk_score": 0.0,
            "risk_level": "very_safe",
            "incident_count": 0,
            "last_incident": None,
        }]
        logger.warning("Returning minimal heatmap due to error")
    
    filtered_clusters = []
    if include_clusters:
        # Admin-only: clusters can be computed/returned for dashboards and analysis.
        # Mobile heatmap UI intentionally does not rely on clusters.
        try:
            clusters = get_clusters()
            all_clusters = []
            for cluster in clusters:
                all_clusters.append(
                    {
                        "id": cluster["id"],
                        "center": cluster["center"],
                        "radius": cluster["radius"],
                        "risk_score": cluster["risk_score"],
                        "incident_count": cluster["incident_count"],
                    }
                )
            filtered_clusters = all_clusters
        except Exception as e:
            logger.error(f"Error getting clusters: {e}", exc_info=True)
            filtered_clusters = []
    
    return {
        "center": {
            "lat": center_lat,
            "lng": center_lng,
        },
        "radius": radius_meters,
        "grid_size": grid_size_meters,
        "cells": cells,
        "clusters": filtered_clusters,
    }


