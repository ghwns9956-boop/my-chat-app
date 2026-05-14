from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
import json
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

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[dict] = []
        self.current_room_name: str = "글로벌 채팅방"

    async def connect(self, websocket: WebSocket, username: str):
        await websocket.accept()
        self.active_connections.append({"ws": websocket, "username": username})
        
        # 접속 시 현재 방 이름 전달
        await websocket.send_text(json.dumps({
            "type": "room_name_changed",
            "new_name": self.current_room_name
        }))
        
        await self.broadcast_system_message(f"{username}님이 채팅방에 입장하셨습니다.")
        await self.broadcast_user_count()

    async def disconnect(self, websocket: WebSocket):
        disconnected_user = None
        for conn in list(self.active_connections):
            if conn["ws"] == websocket:
                disconnected_user = conn["username"]
                self.active_connections.remove(conn)
                break
        if disconnected_user:
            await self.broadcast_system_message(f"{disconnected_user}님이 채팅방을 나갔습니다.")
            await self.broadcast_user_count()

    async def broadcast_message(self, message: str, sender: str, msg_id: str = None, reply_to: dict = None):
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
        await self._send_to_all(data)

    async def broadcast_system_message(self, message: str):
        data = json.dumps({
            "type": "system",
            "message": message
        })
        await self._send_to_all(data)

    async def broadcast_user_count(self):
        data = json.dumps({
            "type": "users_count",
            "count": len(self.active_connections)
        })
        await self._send_to_all(data)

    async def broadcast_typing(self, username: str, is_typing: bool):
        data = json.dumps({
            "type": "typing",
            "username": username,
            "is_typing": is_typing
        })
        dead_connections = []
        for connection in list(self.active_connections):
            if connection["username"] != username:
                try:
                    await connection["ws"].send_text(data)
                except Exception:
                    dead_connections.append(connection)
        for dead in dead_connections:
            await self.disconnect(dead["ws"])

    async def broadcast_image(self, base64_data: str, sender: str):
        time_str = datetime.now(KST).strftime("%H:%M")
        data = json.dumps({
            "type": "image",
            "data": base64_data,
            "sender": sender,
            "time": time_str
        })
        await self._send_to_all(data)

    def update_username(self, websocket: WebSocket, new_username: str) -> str:
        old_username = ""
        for conn in self.active_connections:
            if conn["ws"] == websocket:
                old_username = conn["username"]
                conn["username"] = new_username
                break
        return old_username

    async def update_room_name(self, new_name: str, updater_username: str):
        self.current_room_name = new_name
        data = json.dumps({
            "type": "room_name_changed",
            "new_name": new_name
        })
        await self._send_to_all(data)
        await self.broadcast_system_message(f"{updater_username}님이 채팅방 이름을 [{new_name}](으)로 변경했습니다.")

    async def _send_to_all(self, data: str):
        dead_connections = []
        for connection in list(self.active_connections):
            try:
                await connection["ws"].send_text(data)
            except Exception:
                dead_connections.append(connection)
        for dead in dead_connections:
            await self.disconnect(dead["ws"])

manager = ConnectionManager()

@app.websocket("/ws/{username}")
async def websocket_endpoint(websocket: WebSocket, username: str):
    await manager.connect(websocket, username)
    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                # 클라이언트에서 JSON으로 이벤트를 보낼 경우
                parsed_data = json.loads(raw_data)
                event_type = parsed_data.get("type")
                
                if event_type == "chat":
                    msg_id = parsed_data.get("msgId")
                    reply_to = parsed_data.get("replyTo")
                    current_username = next(conn["username"] for conn in manager.active_connections if conn["ws"] == websocket)
                    await manager.broadcast_message(parsed_data["message"], current_username, msg_id, reply_to)
                
                elif event_type == "typing":
                    current_username = next(conn["username"] for conn in manager.active_connections if conn["ws"] == websocket)
                    await manager.broadcast_typing(current_username, parsed_data["is_typing"])
                    
                elif event_type == "rename":
                    new_username = parsed_data["new_username"]
                    old_username = manager.update_username(websocket, new_username)
                    if old_username:
                        await manager.broadcast_system_message(f"{old_username}님이 {new_username}(으)로 닉네임을 변경했습니다.")
                        
                elif event_type == "rename_room":
                    new_name = parsed_data["new_name"]
                    current_username = next(conn["username"] for conn in manager.active_connections if conn["ws"] == websocket)
                    await manager.update_room_name(new_name, current_username)
                    
                elif event_type == "image":
                    base64_data = parsed_data["data"]
                    current_username = next(conn["username"] for conn in manager.active_connections if conn["ws"] == websocket)
                    await manager.broadcast_image(base64_data, current_username)
                    
                elif event_type == "secret_chat":
                    msg_id = parsed_data.get("msgId")
                    message = parsed_data["message"]
                    current_username = next(conn["username"] for conn in manager.active_connections if conn["ws"] == websocket)
                    time_str = datetime.now(KST).strftime("%H:%M")
                    data = json.dumps({
                        "type": "secret_chat",
                        "message": message,
                        "sender": current_username,
                        "time": time_str,
                        "msgId": msg_id
                    })
                    for connection in manager.active_connections:
                        try:
                            await connection["ws"].send_text(data)
                        except Exception:
                            pass
                        
                elif event_type == "effect":
                    # 흔들기, 폭죽 등 클라이언트 특수 효과 브로드캐스트
                    effect_name = parsed_data.get("effect")
                    current_username = next(conn["username"] for conn in manager.active_connections if conn["ws"] == websocket)
                    data = json.dumps({
                        "type": "effect",
                        "effect": effect_name,
                        "sender": current_username
                    })
                    for connection in manager.active_connections:
                        try:
                            await connection["ws"].send_text(data)
                        except Exception:
                            pass

                elif event_type == "reaction":
                    msg_id = parsed_data.get("msgId")
                    emoji = parsed_data.get("emoji")
                    if msg_id and emoji:
                        data = json.dumps({
                            "type": "reaction",
                            "msgId": msg_id,
                            "emoji": emoji
                        })
                        for connection in manager.active_connections:
                            try:
                                await connection["ws"].send_text(data)
                            except Exception:
                                pass
            except json.JSONDecodeError:
                # 구버전 호환용 (그냥 일반 텍스트가 왔을 때)
                current_username = next((conn["username"] for conn in manager.active_connections if conn["ws"] == websocket), username)
                await manager.broadcast_message(raw_data, current_username)
                
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception as e:
        print(f"WebSocket Client Error: {e}")
        await manager.disconnect(websocket)
