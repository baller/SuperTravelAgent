"""Quarantine current plans whose POIs belong to a different destination.

Revision ID: 0005
Revises: 0004
"""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from uuid import uuid4

from alembic import op
from sqlalchemy import text


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def _distance_km(a: dict, b: dict) -> float:
    lat1, lon1 = math.radians(float(a["latitude"])), math.radians(float(a["longitude"]))
    lat2, lon2 = math.radians(float(b["latitude"])), math.radians(float(b["longitude"]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(value))


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(
        text(
            """
            SELECT trip.id, trip.trip_spec, trip.current_version, version.snapshot
            FROM trips AS trip
            JOIN plan_versions AS version
              ON version.trip_id = trip.id AND version.version = trip.current_version
            WHERE trip.current_version > 0
            """
        )
    ).mappings()
    for row in rows:
        spec = row["trip_spec"] if isinstance(row["trip_spec"], dict) else json.loads(row["trip_spec"])
        snapshot = row["snapshot"] if isinstance(row["snapshot"], dict) else json.loads(row["snapshot"])
        destination = (spec.get("destination") or {}).get("value") or {}
        center = destination.get("coordinates") if isinstance(destination, dict) else None
        if not isinstance(center, dict):
            continue
        coordinates = [
            item.get("place", {}).get("coordinates")
            for day in snapshot.get("days", [])
            for item in day.get("items", [])
            if isinstance(item.get("place"), dict)
        ]
        coordinates = [value for value in coordinates if isinstance(value, dict)]
        if not coordinates:
            continue
        outside = [value for value in coordinates if _distance_km(center, value) > 160]
        if len(outside) * 2 <= len(coordinates):
            continue

        new_version = int(row["current_version"]) + 1
        destination_name = destination.get("name") or destination.get("city") or "新目的地"
        now = datetime.now(UTC)
        quarantined = {
            "days": [],
            "hotel_suggestions": [],
            "conflicts": [
                {
                    "code": "CROSS_CITY_PLAN_QUARANTINED",
                    "level": "blocking",
                    "title": "旧计划地点与当前目的地不一致",
                    "detail": f"已停止显示跨城旧地点。请围绕{destination_name}重新确认必去地点并生成计划。",
                    "day_index": None,
                    "item_ids": [],
                }
            ],
            "known_cost_cny": "0",
            "unknown_cost_items": 0,
            "generated_at": now.isoformat(),
            "source_summary": ["跨城地点安全校验"],
        }
        for field in ("must_visit", "avoid"):
            spec[field] = {"value": [], "state": "MISSING", "source": "cross_city_repair"}
        spec["tickets"] = []
        spec["constraints"] = []
        connection.execute(
            text(
                """
                INSERT INTO plan_versions (id, trip_id, version, snapshot, reason, created_at)
                VALUES (:id, :trip_id, :version, CAST(:snapshot AS JSON), :reason, :created_at)
                """
            ),
            {
                "id": str(uuid4()),
                "trip_id": row["id"],
                "version": new_version,
                "snapshot": json.dumps(quarantined, ensure_ascii=False),
                "reason": "自动隔离与当前目的地不一致的跨城旧计划",
                "created_at": now,
            },
        )
        connection.execute(
            text(
                """
                UPDATE trips
                SET current_version = :version,
                    trip_spec = CAST(:trip_spec AS JSON),
                    lifecycle = 'CLARIFYING',
                    pulse = '需要补充',
                    updated_at = :updated_at
                WHERE id = :trip_id
                """
            ),
            {
                "version": new_version,
                "trip_spec": json.dumps(spec, ensure_ascii=False),
                "updated_at": now,
                "trip_id": row["id"],
            },
        )


def downgrade() -> None:
    # Historical versions are immutable audit records.  A downgrade leaves the
    # protective version in place rather than silently reactivating bad POIs.
    pass
