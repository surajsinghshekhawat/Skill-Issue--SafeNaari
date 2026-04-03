"""
Clustering Module - DBSCAN for unsafe zone detection
"""

from typing import List, Dict, Optional
import numpy as np
from sklearn.cluster import DBSCAN
from app.config import settings
from app.db.storage import get_incidents
from app.api.schemas import IncidentRequest, RiskCluster, Location

# Cache for clusters
_clusters_cache: Optional[List[Dict]] = None
_clusters_last_update: Optional[float] = None


def update_clusters_if_needed(incident: IncidentRequest) -> List[str]:
    """
    Update clusters if needed after new incident
    
    Args:
        incident: New incident that was added
        
    Returns:
        List of affected cluster IDs
    """
    global _clusters_cache, _clusters_last_update
    
    # Invalidate cache
    _clusters_cache = None
    _clusters_last_update = None
    
    # For now, return empty list
    # Full implementation would recalculate clusters
    return []


def get_clusters(force_recalculate: bool = False) -> List[Dict]:
    """
    Get unsafe zone clusters using DBSCAN
    
    Args:
        force_recalculate: Force recalculation even if cache exists
        
    Returns:
        List of cluster dictionaries
    """
    global _clusters_cache, _clusters_last_update
    
    if _clusters_cache is not None and not force_recalculate:
        return _clusters_cache
    
    # Get all incidents (exclude explicitly rejected ones)
    incidents_all = get_incidents()
    incidents: List[Dict] = []
    for inc in incidents_all:
        try:
            if (not bool(inc.get("verified", False))) and inc.get("moderation_reason", None) not in (None, "", False):
                continue
        except Exception:
            pass
        incidents.append(inc)
    
    if len(incidents) < settings.dbscan_min_samples:
        _clusters_cache = []
        return []
    
    # Prepare data for clustering
    coordinates = np.array([
        [incident["latitude"], incident["longitude"]]
        for incident in incidents
    ])
    
    # Apply DBSCAN clustering
    clustering = DBSCAN(
        eps=settings.dbscan_eps,
        min_samples=settings.dbscan_min_samples,
        metric='euclidean'
    )
    
    cluster_labels = clustering.fit_predict(coordinates)
    
    # Extract cluster information
    clusters = []
    unique_labels = set(cluster_labels)
    
    # Remove noise label (-1)
    unique_labels.discard(-1)
    
    for cluster_id in unique_labels:
        # Get incidents in this cluster
        cluster_indices = np.where(cluster_labels == cluster_id)[0]
        cluster_incidents = [incidents[i] for i in cluster_indices]
        
        # Calculate cluster center
        cluster_coords = coordinates[cluster_indices]
        center_lat = float(np.mean(cluster_coords[:, 0]))
        center_lng = float(np.mean(cluster_coords[:, 1]))
        
        # Calculate cluster radius (max distance from center)
        distances = np.sqrt(
            np.sum((cluster_coords - [center_lat, center_lng])**2, axis=1)
        )
        radius_degrees = float(np.max(distances))
        radius_meters = radius_degrees * 111000  # Convert to meters
        
        # Calculate average risk score for cluster
        from app.ml.risk_scoring import calculate_risk_score
        risk_data = calculate_risk_score(center_lat, center_lng)
        
        clusters.append({
            "id": f"cluster_{cluster_id}",
            "center": {
                "lat": center_lat,
                "lng": center_lng,
            },
            "radius": radius_meters,
            "risk_score": risk_data["risk_score"],
            "incident_count": len(cluster_incidents),
        })
    
    _clusters_cache = clusters
    return clusters

