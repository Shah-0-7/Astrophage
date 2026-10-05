"""
============================================================
NISAR InSAR Microservice – FastAPI Entry Point
============================================================
Provides REST API routes for InSAR processing using ISCE2
and MintPy. Designed to accept bounding boxes, trigger
SAR data downloads, unwrap phase, and return compressed
displacement heatmaps.

Start with:
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
============================================================
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.insar import router as insar_router

app = FastAPI(
    title="NISAR InSAR Microservice",
    description="Phase unwrapping, displacement heatmap, and SAR pipeline API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(insar_router, prefix="/api/insar")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "nisar-insar-microservice"}
