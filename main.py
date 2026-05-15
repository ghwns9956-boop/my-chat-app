from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse, JSONResponse
from pydantic import BaseModel
import json
import string
import random
from datetime import datetime, timezone, timedelta
import asyncio

# 한국 표준시(KST) 설정 (UTC+9)
KST = timezone(timedelta(hours=9))

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return RedirectResponse(url="/static/index.html")

@app.head("/")
async def ping_head():
    return {"status": "ok"}

class RoomCreateRequest(BaseModel):
    manager_code: str
    room_name: str
    creator: str

class ConnectionManager:
    def __init__(self):
        # room_code -> { "name": str, "creator": str, "connections": list[dict] }
        # 기본 오픈채팅방 생성 방지 (코드를 알아야만 입장 가능하게)
        self.rooms: dict[str, dict] = {}

    def generate_room_code(self):
        while True:
            code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))
            if code not in self.rooms:
                return code

    async def connect(self, websocket: WebSocket, room_code: str, username: str):
        await websocket.accept()
        if room_code not in self.rooms:
            # 방이 없으면 연결 종료
            await websocket.close(code=1008)
            return

        self.rooms[room_code]["connections"].append({"ws": websocket, "username": username})
        
        # 접속 시 현재 방 이름 전달
        await websocket.send_text(json.dumps({
            "type": "room_name_changed",
            "new_name": self.rooms[room_code]["name"]
        }))
        
        await self.broadcast_system_message(room_code, f"{username}님이 채팅방에 입장하셨습니다.")
        await self.broadcast_user_count(room_code)

    async def disconnect(self, websocket: WebSocket, room_code: str):
        if room_code not in self.rooms:
            return

        disconnected_user = None
        conns = self.rooms[room_code]["connections"]
        for conn in list(conns):
            if conn["ws"] == websocket:
                disconnected_user = conn["username"]
                conns.remove(conn)
                break
        
        if disconnected_user:
            await self.broadcast_system_message(room_code, f"{disconnected_user}님이 채팅방을 나갔습니다.")
            await self.broadcast_user_count(room_code)
            
        # 방에 아무도 없으면 방 삭제 (선택사항, 일단은 유지)
        # if len(conns) == 0:
        #     del self.rooms[room_code]

    async def broadcast_message(self, room_code: str, message: str, sender: str, msg_id: str = None, reply_to: dict = None):
        time_str = datetime.now(KST).strftime("%H:%M")
        payload = {
            "type": "chat",
            "message": message,
            "sender": sender,
            "time": time_str
        }
        if msg_id:
            payload["msgId"] = msg_id
        if reply_to:
            payload["replyTo"] = reply_to
            
        data = json.dumps(payload)
        await self._send_to_all(room_code, data)

    async def broadcast_system_message(self, room_code: str, message: str):
        data = json.dumps({
            "type": "system",
            "message": message
        })
        await self._send_to_all(room_code, data)

    async def broadcast_user_count(self, room_code: str):
        if room_code not in self.rooms: return
        data = json.dumps({
            "type": "users_count",
            "count": len(self.rooms[room_code]["connections"])
        })
        await self._send_to_all(room_code, data)

    async def broadcast_typing(self, room_code: str, username: str, is_typing: bool):
        if room_code not in self.rooms: return
        data = json.dumps({
            "type": "typing",
            "username": username,
            "is_typing": is_typing
        })
        dead_connections = []
        conns = self.rooms[room_code]["connections"]
        for connection in list(conns):
            if connection["username"] != username:
                try:
                    await connection["ws"].send_text(data)
                except Exception:
                    dead_connections.append(connection)
        for dead in dead_connections:
            await self.disconnect(dead["ws"], room_code)

    async def broadcast_image(self, room_code: str, base64_data: str, sender: str):
        time_str = datetime.now(KST).strftime("%H:%M")
        data = json.dumps({
            "type": "image",
            "data": base64_data,
            "sender": sender,
            "time": time_str
        })
        await self._send_to_all(room_code, data)

    def update_username(self, websocket: WebSocket, room_code: str, new_username: str) -> str:
        if room_code not in self.rooms: return ""
        old_username = ""
        for conn in self.rooms[room_code]["connections"]:
            if conn["ws"] == websocket:
                old_username = conn["username"]
                conn["username"] = new_username
                break
        return old_username

    async def update_room_name(self, room_code: str, new_name: str, updater_username: str):
        if room_code not in self.rooms: return
        self.rooms[room_code]["name"] = new_name
        data = json.dumps({
            "type": "room_name_changed",
            "new_name": new_name
        })
        await self._send_to_all(room_code, data)
        await self.broadcast_system_message(room_code, f"{updater_username}님이 채팅방 이름을 [{new_name}](으)로 변경했습니다.")

    async def _send_to_all(self, room_code: str, data: str):
        if room_code not in self.rooms: return
        dead_connections = []
        conns = self.rooms[room_code]["connections"]
        for connection in list(conns):
            try:
                await connection["ws"].send_text(data)
            except Exception:
                dead_connections.append(connection)
        for dead in dead_connections:
            await self.disconnect(dead["ws"], room_code)

manager = ConnectionManager()

@app.post("/api/rooms")
async def create_room(req: RoomCreateRequest):
    if req.manager_code != "555":
        return JSONResponse(status_code=403, content={"error": "관리자 코드가 일치하지 않습니다."})
    
    code = manager.generate_room_code()
    manager.rooms[code] = {
        "name": req.room_name,
        "creator": req.creator,
        "connections": []
    }
    return {"invite_code": code}

@app.get("/api/rooms/{code}")
async def check_room(code: str):
    code = code.upper()
    if code in manager.rooms:
        room = manager.rooms[code]
        return {"exists": True, "name": room["name"], "creator": room["creator"]}
    return {"exists": False}


@app.websocket("/ws/{room_code}/{username}")
async def websocket_endpoint(websocket: WebSocket, room_code: str, username: str):
    room_code = room_code.upper()
    await manager.connect(websocket, room_code, username)
    if room_code not in manager.rooms:
        return

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                parsed_data = json.loads(raw_data)
                event_type = parsed_data.get("type")
                
                # Helper function to get current username
                def get_current_username():
                    conns = manager.rooms[room_code]["connections"]
                    for conn in conns:
                        if conn["ws"] == websocket:
                            return conn["username"]
                    return username

                current_username = get_current_username()

                if event_type == "chat":
                    msg_id = parsed_data.get("msgId")
                    reply_to = parsed_data.get("replyTo")
                    await manager.broadcast_message(room_code, parsed_data["message"], current_username, msg_id, reply_to)
                
                elif event_type == "typing":
                    await manager.broadcast_typing(room_code, current_username, parsed_data["is_typing"])
                    
                elif event_type == "rename":
                    new_username = parsed_data["new_username"]
                    old_username = manager.update_username(websocket, room_code, new_username)
                    if old_username:
                        await manager.broadcast_system_message(room_code, f"{old_username}님이 {new_username}(으)로 닉네임을 변경했습니다.")
                        
                elif event_type == "rename_room":
                    new_name = parsed_data["new_name"]
                    await manager.update_room_name(room_code, new_name, current_username)
                    
                elif event_type == "image":
                    base64_data = parsed_data["data"]
                    await manager.broadcast_image(room_code, base64_data, current_username)
                    
                elif event_type == "secret_chat":
                    msg_id = parsed_data.get("msgId")
                    message = parsed_data["message"]
                    time_str = datetime.now(KST).strftime("%H:%M")
                    data = json.dumps({
                        "type": "secret_chat",
                        "message": message,
                        "sender": current_username,
                        "time": time_str,
                        "msgId": msg_id
                    })
                    await manager._send_to_all(room_code, data)
                        
                elif event_type == "effect":
                    effect_name = parsed_data.get("effect")
                    data = json.dumps({
                        "type": "effect",
                        "effect": effect_name,
                        "sender": current_username
                    })
                    await manager._send_to_all(room_code, data)

                elif event_type == "reaction":
                    msg_id = parsed_data.get("msgId")
                    emoji = parsed_data.get("emoji")
                    if msg_id and emoji:
                        data = json.dumps({
                            "type": "reaction",
                            "msgId": msg_id,
                            "emoji": emoji
                        })
                        await manager._send_to_all(room_code, data)
            except json.JSONDecodeError:
                # 구버전 텍스트
                current_username = next((conn["username"] for conn in manager.rooms[room_code]["connections"] if conn["ws"] == websocket), username)
                await manager.broadcast_message(room_code, raw_data, current_username)
                
    except WebSocketDisconnect:
        await manager.disconnect(websocket, room_code)
    except Exception as e:
        print(f"WebSocket Client Error: {e}")
        await manager.disconnect(websocket, room_code)
