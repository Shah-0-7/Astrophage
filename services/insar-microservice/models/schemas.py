from pydantic import BaseModel, Field
from typing import Literal, Optional


class BoundingBox(BaseModel):
    west:  float = Field(..., ge=-180, le=180)
    south: float = Field(..., ge=-90,  le=90)
    east:  float = Field(..., ge=-180, le=180)
    north: float = Field(..., ge=-90,  le=90)


class UnwrapRequest(BaseModel):
    bbox:            BoundingBox
    reference_date:  str = Field(..., pattern=r"\d{4}-\d{2}-\d{2}")
    secondary_date:  str = Field(..., pattern=r"\d{4}-\d{2}-\d{2}")
    polarisation:    Literal["VV", "VH", "HH", "HV"] = "VV"


class UnwrapResponse(BaseModel):
    job_id: str
    status: str


class ProcessingStatus(BaseModel):
    job_id:     str
    status:     Literal["QUEUED", "DOWNLOADING", "PROCESSING", "COMPLETE", "ERROR"]
    progress:   int = Field(default=0, ge=0, le=100)
    message:    str = ""
    result_url: Optional[str] = None
