"""Small, dependency-free ticket catalogue API for local UI testing.

The production ticket API in ``blockchain_backend.py`` requires a deployed smart
contract, RPC endpoint, payment credentials, and the complete production schema.
This server deliberately implements only the read-only catalogue endpoints used
while testing the OpenID4VCI issuance UI locally.
"""

from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware


KST = timezone(timedelta(hours=9))

EVENTS = [
    {
        "id": 1,
        "name": "IU Concert: The Golden Hour",
        "time": "2026.10.10 19:00",
        "location": "고척스카이돔",
        "image": "/posters/iu.png",
        "period": "2026.10.10 - 2026.10.12",
        "age": "전체관람가",
        "price": "143,000",
        "price_amount": 143000,
        "status": "active",
        "category": "concert",
    },
    {
        "id": 2,
        "name": "오페라의 유령",
        "time": "2026.10.03 19:30",
        "location": "블루스퀘어 신한카드홀",
        "image": "/posters/theopera.png",
        "period": "2026.10.01 - 2027.01.31",
        "age": "8세 이상",
        "price": "160,000",
        "price_amount": 160000,
        "status": "active",
        "category": "musical",
    },
    {
        "id": 3,
        "name": "레미제라블",
        "time": "2026.11.07 19:30",
        "location": "샤롯데씨어터",
        "image": "/posters/lesmiserables.png",
        "period": "2026.11.01 - 2027.02.28",
        "age": "7세 이상",
        "price": "150,000",
        "price_amount": 150000,
        "status": "active",
        "category": "musical",
    },
    {
        "id": 4,
        "name": "Aimer Live in Seoul",
        "time": "2026.10.17 18:00",
        "location": "올림픽공원 올림픽홀",
        "image": "/posters/aimer.png",
        "period": "2026.10.17 - 2026.10.18",
        "age": "12세 이상",
        "price": "121,000",
        "price_amount": 121000,
        "status": "active",
        "category": "concert",
    },
    {
        "id": 5,
        "name": "호두까기 인형",
        "time": "2026.12.20 17:00",
        "location": "예술의전당 오페라극장",
        "image": "/posters/hearthstone.png",
        "period": "2026.12.20 - 2026.12.28",
        "age": "5세 이상",
        "price": "80,000",
        "price_amount": 80000,
        "status": "active",
        "category": "classic",
    },
    {
        "id": 6,
        "name": "Blockchain Week 2026",
        "time": "2026.11.14 10:00",
        "location": "부산 BEXCO",
        "image": "/posters/blockchainweek.jpg",
        "period": "2026.11.14 - 2026.11.15",
        "age": "전체관람가",
        "price": "무료",
        "price_amount": 0,
        "status": "active",
        "category": "conference",
    },
]


def event_start(event_id: int) -> datetime:
    event = next((item for item in EVENTS if item["id"] == event_id), None)
    if not event:
        raise HTTPException(status_code=404, detail="공연 정보를 찾을 수 없습니다.")
    return datetime.strptime(event["time"], "%Y.%m.%d %H:%M").replace(tzinfo=KST)


def sessions_for_event(event_id: int) -> list[dict]:
    start = event_start(event_id)
    return [
        {
            "id": event_id * 100 + index,
            "event_id": event_id,
            "session_name": f"{index}회차",
            "session_start_at": (start + timedelta(days=index - 1)).isoformat(),
            "session_end_at": (start + timedelta(days=index - 1, hours=3)).isoformat(),
            "sale_status": "open",
        }
        for index in (1, 2)
    ]


app = FastAPI(title="TicketPro Local Catalogue API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "mode": "local-demo"}


@app.get("/api/events")
async def list_events():
    return {"status": "success", "data": EVENTS}


@app.get("/api/events/{event_id}")
async def event_detail(event_id: int):
    event = next((item for item in EVENTS if item["id"] == event_id), None)
    if not event:
        raise HTTPException(status_code=404, detail="공연 정보를 찾을 수 없습니다.")
    return {"status": "success", "data": event}


@app.get("/api/events/{event_id}/sessions")
async def event_sessions(event_id: int):
    return {"status": "success", "data": sessions_for_event(event_id)}


@app.get("/api/sessions/{session_id}/seats")
async def session_seats(session_id: int):
    event_id = session_id // 100
    event = next((item for item in EVENTS if item["id"] == event_id), None)
    if not event or session_id not in {event_id * 100 + 1, event_id * 100 + 2}:
        raise HTTPException(status_code=404, detail="공연 회차를 찾을 수 없습니다.")
    seats = [
        {
            "id": session_id * 1000 + number,
            "event_session_id": session_id,
            "seat_code": f"A{number}",
            "section_name": "STANDARD",
            "row_label": "A",
            "seat_number": str(number),
            "grade": "일반석",
            "price_amount": event["price_amount"],
            "status": "available",
        }
        for number in range(1, 21)
    ]
    return {"status": "success", "data": seats}
