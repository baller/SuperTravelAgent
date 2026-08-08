from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.agent.llm import llm_client


async def run(path: Path) -> int:
    scenarios = json.loads(path.read_text(encoding="utf-8"))
    results = []
    for scenario in scenarios:
        try:
            extraction_call = await llm_client.extract_request(
                scenario["message"],
                scenario.get("trip_context"),
            )
            extracted = extraction_call.value
            expected = set(scenario["expected_intents"])
            passed = extracted.intent.value in expected
            for field, expected_value in scenario.get("expected_fields", {}).items():
                actual = getattr(extracted, field)
                if isinstance(expected_value, list):
                    passed = passed and all(value in (actual or []) for value in expected_value)
                else:
                    passed = passed and actual == expected_value
            results.append(
                {
                    "id": scenario["id"],
                    "passed": passed,
                    "actual_intent": extracted.intent.value,
                }
            )
        except Exception as exc:
            results.append({"id": scenario["id"], "passed": False, "error": str(exc)})
    passed_count = sum(1 for result in results if result["passed"])
    rate = passed_count / len(results) if results else 0
    print(json.dumps({"passed": passed_count, "total": len(results), "rate": rate, "results": results}, ensure_ascii=False, indent=2))
    return 0 if rate >= 0.9 else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the 30-case SuperTravel Agent extraction evaluation.")
    parser.add_argument(
        "--scenarios",
        type=Path,
        default=Path("packages/evals/agent_scenarios.json"),
    )
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args.scenarios)))


if __name__ == "__main__":
    main()
