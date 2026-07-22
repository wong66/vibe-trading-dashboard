"""Settings routes for Vibe-Trading API."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..auth import require_local_or_auth
from ..models import (
    DataSourceSettingsResponse,
    LLMSettingsResponse,
    UpdateDataSourceSettingsRequest,
    UpdateLLMSettingsRequest,
)
from ..settings import (
    _build_data_source_settings_response,
    _build_llm_settings_response,
    _update_data_source_settings_impl,
    _update_llm_settings_impl,
)

router = APIRouter()


@router.get("/settings/llm", response_model=LLMSettingsResponse, dependencies=[Depends(require_local_or_auth)])
async def get_llm_settings():
    return _build_llm_settings_response()


@router.put("/settings/llm", response_model=LLMSettingsResponse, dependencies=[Depends(require_local_or_auth)])
async def update_llm_settings(payload: UpdateLLMSettingsRequest):
    return await _update_llm_settings_impl(payload)


@router.get("/settings/data-sources", response_model=DataSourceSettingsResponse, dependencies=[Depends(require_local_or_auth)])
async def get_data_source_settings():
    return _build_data_source_settings_response()


@router.put("/settings/data-sources", response_model=DataSourceSettingsResponse, dependencies=[Depends(require_local_or_auth)])
async def update_data_source_settings(payload: UpdateDataSourceSettingsRequest):
    return await _update_data_source_settings_impl(payload)
