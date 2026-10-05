"""
============================================================
InSAR API Routes – /api/insar/*
============================================================
"""

import asyncio
import uuid
from typing import Literal
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from core.isce2_runner import run_isce2_pipeline
from core.mintpy_runner import run_mintpy_timeseries
from models.schemas import (
    BoundingBox,
    UnwrapRequest,
    UnwrapResponse,
    ProcessingStatus,
)

router = APIRouter()

# In-memory job store (replace with Redis/DB in production)
_jobs: dict[str, ProcessingStatus] = {}


# ── POST /api/insar/unwrap ────────────────────────────────────
@router.post("/unwrap", response_model=UnwrapResponse)
async def submit_unwrap(
    req: UnwrapRequest,
    bg: BackgroundTasks,
):
    """
    Accept a bounding box + date range, download Sentinel-1 SLC data,
    run ISCE2 interferogram formation, and return a job ID.
    The actual processing runs in the background.
    """
    job_id = str(uuid.uuid4())
    _jobs[job_id] = ProcessingStatus(
        job_id=job_id,
        status="QUEUED",
        progress=0,
        message="Job accepted",
    )

    bg.add_task(_process_unwrap, job_id, req)
    return UnwrapResponse(job_id=job_id, status="QUEUED")


async def _process_unwrap(job_id: str, req: UnwrapRequest):
    """Background task: ISCE2 → MintPy → compressed heatmap."""
    try:
        _jobs[job_id].status = "DOWNLOADING"
        _jobs[job_id].message = "Downloading SAR data..."
        _jobs[job_id].progress = 5

        # Step 1: Download & form interferogram with ISCE2
        isce_result = await run_isce2_pipeline(
            bbox=req.bbox,
            reference_date=req.reference_date,
            secondary_date=req.secondary_date,
            polarisation=req.polarisation,
        )

        _jobs[job_id].status = "PROCESSING"
        _jobs[job_id].message = "Running MintPy time series..."
        _jobs[job_id].progress = 60

        # Step 2: MintPy time series inversion
        heatmap_url = await run_mintpy_timeseries(
            ifg_path=isce_result["ifg_path"],
            job_id=job_id,
        )

        _jobs[job_id].status = "COMPLETE"
        _jobs[job_id].progress = 100
        _jobs[job_id].message = "Processing complete"
        _jobs[job_id].result_url = heatmap_url

    except Exception as exc:
        _jobs[job_id].status = "ERROR"
        _jobs[job_id].message = str(exc)


# ── GET /api/insar/status/{job_id} ───────────────────────────
@router.get("/status/{job_id}", response_model=ProcessingStatus)
async def get_status(job_id: str):
    """Poll processing status for a submitted unwrap job."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


# ── GET /api/insar/download ───────────────────────────────────
@router.get("/download")
async def list_available(
    bbox: str = "-120,35,-115,40",
    days: int = 30,
):
    """
    Query available Sentinel-1 SLC pairs over a bounding box.
    Returns a list of (reference, secondary) date pairs suitable
    for interferometric processing.
    """
    # Stub: real implementation queries ASF/Copernicus DAAC
    west, south, east, north = map(float, bbox.split(","))
    return {
        "bbox": {"west": west, "south": south, "east": east, "north": north},
        "available_pairs": [
            {"reference": "2024-01-01", "secondary": "2024-01-13", "baseline_m": 42},
            {"reference": "2024-01-13", "secondary": "2024-01-25", "baseline_m": 18},
            {"reference": "2024-01-25", "secondary": "2024-02-06", "baseline_m": 61},
        ],
        "note": "Connect ASF DAAC credentials via env vars ASF_USER / ASF_PASS for live data",
    }
