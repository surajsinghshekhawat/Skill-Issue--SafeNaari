"""
In-memory data storage for incidents (dev / ML service local state).
Production option: sync incidents to Postgres via the Node API or replace this module
with DB-backed storage when you need multi-instance ML workers.
"""

from typing import List, Dict, Optional
from datetime import datetime
from app.api.schemas import IncidentRequest

# In-memory storage (will be replaced with database)
_incidents: List[Dict] = []
_incident_counter = 0


def add_incident(incident: IncidentRequest) -> str:
    """
    Add incident to storage
    
    Args:
        incident: IncidentRequest object
        
    Returns:
        incident_id: ID of stored incident
    """
    global _incident_counter
    
    incident_dict = {
        "id": incident.id,
        "latitude": incident.latitude,
        "longitude": incident.longitude,
        "timestamp": incident.timestamp,
        "type": incident.type,
        "severity": incident.severity,
        "category": incident.category,
        "verified": incident.verified,
        "user_id": incident.user_id,
    }
    
    _incidents.append(incident_dict)
    _incident_counter += 1
    
    return incident.id


def get_incidents(
    lat_min: Optional[float] = None,
    lat_max: Optional[float] = None,
    lng_min: Optional[float] = None,
    lng_max: Optional[float] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
) -> List[Dict]:
    """
    Get incidents with optional filtering
    
    Args:
        lat_min, lat_max: Latitude bounds
        lng_min, lng_max: Longitude bounds
        start_time, end_time: Time range
        
    Returns:
        List of incident dictionaries
    """
    filtered = _incidents.copy()
    
    # Filter by location bounds
    if lat_min is not None:
        filtered = [i for i in filtered if i["latitude"] >= lat_min]
    if lat_max is not None:
        filtered = [i for i in filtered if i["latitude"] <= lat_max]
    if lng_min is not None:
        filtered = [i for i in filtered if i["longitude"] >= lng_min]
    if lng_max is not None:
        filtered = [i for i in filtered if i["longitude"] <= lng_max]
    
    # Filter by time range
    if start_time is not None:
        filtered = [i for i in filtered if i["timestamp"] >= start_time]
    if end_time is not None:
        filtered = [i for i in filtered if i["timestamp"] <= end_time]
    
    return filtered


def get_incident_count() -> int:
    """Get total number of incidents"""
    return len(_incidents)


def get_all_incidents() -> List[Dict]:
    """Get all incidents (for model training)"""
    return _incidents.copy()


def clear_incidents():
    """Clear all incidents (for testing)"""
    global _incidents, _incident_counter
    _incidents = []
    _incident_counter = 0



