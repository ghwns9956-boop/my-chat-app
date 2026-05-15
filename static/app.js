const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const usernameInput = document.getElementById('username-input');
const randomNameBtn = document.getElementById('random-name-btn');

// 로비 탭 및 폼
const tabJoin = document.getElementById('tab-join');
const tabCreate = document.getElementById('tab-create');
const joinForm = document.getElementById('join-form');
const createForm = document.getElementById('create-form');
const inviteCodeInput = document.getElementById('invite-code-input');
const managerCodeInput = document.getElementById('manager-code-input');
const newRoomNameInput = document.getElementById('new-room-name-input');

// 채팅 화면 요소
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const chatMessages = document.getElementById('chat-messages');
const logoutBtn = document.getElementById('logout-btn');
const renameBtn = document.getElementById('rename-btn');
const userCountDisplay = document.getElementById('user-count-display');
const typingIndicator = document.getElementById('typing-indicator');
const typingText = document.getElementById('typing-text');
const roomNameDisplay = document.getElementById('room-name-display');
const attachBtn = document.getElementById('attach-btn');
const imageUploadInput = document.getElementById('image-upload-input');
const dragOverlay = document.getElementById('drag-overlay');

// 확대 모달 엘리먼트
const imageZoomModal = document.getElementById('image-zoom-modal');
const zoomedImage = document.getElementById('zoomed-image');
const closeZoomBtn = document.getElementById('close-zoom-btn');
const bossKeyOverlay = document.getElementById('boss-key-overlay');
const secretBtn = document.getElementById('secret-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const replyingToContainer = document.getElementById('replying-to-container');
const replyingToName = document.getElementById('replying-to-name');
const replyingToText = document.getElementById('replying-to-text');
const cancelReplyBtn = document.getElementById('cancel-reply-btn');

// 방 관리 모달 엘리먼트
const manageRoomBtn = document.getElementById('manage-room-btn');
const roomManageModal = document.getElementById('room-manage-modal');
const closeManageBtn = document.getElementById('close-manage-btn');
const manageInviteCode = document.getElementById('manage-invite-code');
const copyCodeBtn = document.getElementById('copy-code-btn');
const manageRoomNameInput = document.getElementById('manage-room-name-input');
const manageRenameBtn = document.getElementById('manage-rename-btn');

// 사이드바 엘리먼트
const roomSidebar = document.getElementById('room-sidebar');
const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
const closeSidebarBtn = document.getElementById('close-sidebar-btn');
const roomListContainer = document.getElementById('room-list-container');
const sidebarAddRoomBtn = document.getElementById('sidebar-add-room-btn');

let ws = null;
let currentUsername = localStorage.getItem('chat_username') || '';
let typingTimeout = null;
let activeTypers = new Set();
let currentRoomName = "채팅방";
let currentRoomCode = localStorage.getItem('chat_last_room') || '';
let isCreator = false;
let isSecretMode = false;
let localHistory = [];
let replyingTo = null;

// 사이드바 방 리스트 배열
let savedRooms = JSON.parse(localStorage.getItem('chat_saved_rooms')) || [];

// 오디오 컨텍스트 (알림음용)
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playBeep() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note
    oscillator.frequency.exponentialRampToValueAtTime(1760, audioCtx.currentTime + 0.1); // Slide to A6
    
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.1);
}

// 다중 방 저장 및 렌더링 로직
function addSavedRoom(code, name) {
    savedRooms = savedRooms.filter(r => r.code !== code); 
    savedRooms.unshift({code, name}); 
    localStorage.setItem('chat_saved_rooms', JSON.stringify(savedRooms));
    renderSidebarRooms();
}

window.removeSavedRoom = function(code) {
    savedRooms = savedRooms.filter(r => r.code !== code);
    localStorage.setItem('chat_saved_rooms', JSON.stringify(savedRooms));
    renderSidebarRooms();
    
    // 만약 현재 지운 방이 접속중인 방이라면 로비로 튕기기
    if(code === currentRoomCode) {
        logout();
    }
}

function renderSidebarRooms() {
    roomListContainer.innerHTML = '';
    
    savedRooms.forEach(room => {
        const item = document.createElement('div');
        item.className = `room-item ${room.code === currentRoomCode ? 'active' : ''}`;
        item.innerHTML = `
            <div class="room-item-info" onclick="switchRoom('${room.code}')">
                <span class="room-item-name">${escapeHTML(room.name)}</span>
                <span class="room-item-code">${escapeHTML(room.code)}</span>
            </div>
            <button class="remove-room-btn" onclick="removeSavedRoom('${room.code}')" title="방 지우기">✕</button>
        `;
        roomListContainer.appendChild(item);
    });
}

// 사이드바 토글 이벤트
if(toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => {
        roomSidebar.classList.add('open');
    });
}
if(closeSidebarBtn) {
    closeSidebarBtn.addEventListener('click', () => {
        roomSidebar.classList.remove('open');
    });
}

// 사이드바에서 [+ 새 방 추가] 클릭 시
if(sidebarAddRoomBtn) {
    sidebarAddRoomBtn.addEventListener('click', () => {
        roomSidebar.classList.remove('open');
        logout(); // 기존 방에서 나가고 로비로 이동
    });
}

// 방 스위치 로직
window.switchRoom = async function(newCode) {
    if (newCode === currentRoomCode) return;
    
    try {
        const res = await fetch(`/api/rooms/${newCode}`);
        if (res.ok) {
            const data = await res.json();
            if (data.exists) {
                if (ws) {
                    ws.onclose = null; // 의도적 연결 끊김이므로 onclose 핸들러 무시
                    ws.close();
                }
                
                currentRoomCode = newCode;
                currentRoomName = data.name;
                isCreator = (data.creator === currentUsername);
                
                roomSidebar.classList.remove('open');
                
                localStorage.setItem('chat_last_room', currentRoomCode);
                connectWebSocket(newCode, currentUsername);
            } else {
                alert("해당 채팅방이 더 이상 존재하지 않거나 폭파되었습니다.");
                removeSavedRoom(newCode);
            }
        }
    } catch (e) {
        alert("서버 연결에 실패했습니다.");
    }
}


// 화면 진입 시 초기화
window.addEventListener('DOMContentLoaded', async () => {
    if (currentUsername) {
        usernameInput.value = currentUsername;
    }
    
    // 만약 `chat_last_room`이 없다면 `savedRooms` 배열의 첫 번째 방으로 시도
    if (!currentRoomCode && savedRooms.length > 0) {
        currentRoomCode = savedRooms[0].code;
    }
    
    // 이전에 접속했던 방 코드가 있다면 자동 접속 시도
    if (currentUsername && currentRoomCode) {
        inviteCodeInput.value = currentRoomCode;
        try {
            const res = await fetch(`/api/rooms/${currentRoomCode}`);
            if (res.ok) {
                const data = await res.json();
                if (data.exists) {
                    currentRoomName = data.name;
                    isCreator = (data.creator === currentUsername);
                    connectWebSocket(currentRoomCode, currentUsername);
                } else {
                    // 서버가 재부팅되어 방이 사라진 경우 리스트에서 삭제
                    localStorage.removeItem('chat_last_room');
                    removeSavedRoom(currentRoomCode);
                    currentRoomCode = "";
                    inviteCodeInput.value = "";
                }
            }
        } catch (err) {
            console.error("자동 접속 실패", err);
        }
    }
});

// 알림 관련 변수
let unreadCount = 0;
const favicon = document.getElementById('favicon');
const pageTitle = document.getElementById('page-title');
const originalFavicon = favicon.href;

document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
        unreadCount = 0;
        pageTitle.textContent = currentRoomName;
        favicon.href = originalFavicon;
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        if (chatScreen.classList.contains('active')) {
            bossKeyOverlay.classList.toggle('hidden');
        }
    }
});

function updateNotificationBadge() {
    if (document.hidden) {
        unreadCount++;
        pageTitle.textContent = `(${unreadCount}) ${currentRoomName}`;
        
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💬', 16, 16);
        
        ctx.beginPath();
        ctx.arc(24, 8, 8, 0, 2 * Math.PI);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Inter, Arial';
        const displayNum = unreadCount > 9 ? '9+' : unreadCount;
        ctx.fillText(displayNum, 24, 8);
        
        favicon.href = canvas.toDataURL('image/png');
    }
}

const adjectives = ["행복한", "슬픈", "게으른", "용감한", "수줍은", "배고픈", "심심한", "졸린", "똑똑한", "빠른"];
const nouns = ["다람쥐", "호랑이", "거북이", "고양이", "강아지", "코끼리", "독수리", "펭귄", "팬더", "토끼"];

randomNameBtn.addEventListener('click', () => {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    usernameInput.value = `${adj} ${noun}`;
});

// 로비 탭 전환 로직
tabJoin.addEventListener('click', () => {
    tabJoin.classList.add('active');
    tabJoin.style.background = 'rgba(255,255,255,0.1)';
    tabJoin.style.color = 'var(--text-main)';
    tabJoin.style.borderColor = 'var(--border)';
    
    tabCreate.classList.remove('active');
    tabCreate.style.background = 'transparent';
    tabCreate.style.color = 'var(--text-muted)';
    tabCreate.style.borderColor = 'transparent';
    
    joinForm.classList.remove('hidden');
    createForm.classList.add('hidden');
});

tabCreate.addEventListener('click', () => {
    tabCreate.classList.add('active');
    tabCreate.style.background = 'rgba(255,255,255,0.1)';
    tabCreate.style.color = 'var(--text-main)';
    tabCreate.style.borderColor = 'var(--border)';
    
    tabJoin.classList.remove('active');
    tabJoin.style.background = 'transparent';
    tabJoin.style.color = 'var(--text-muted)';
    tabJoin.style.borderColor = 'transparent';
    
    createForm.classList.remove('hidden');
    joinForm.classList.add('hidden');
});

// 방 참가 폼 제출
joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const inviteCode = inviteCodeInput.value.trim().toUpperCase();
    
    if (!username || !inviteCode) return;
    
    try {
        const res = await fetch(`/api/rooms/${inviteCode}`);
        const data = await res.json();
        
        if (data.exists) {
            currentUsername = username;
            currentRoomCode = inviteCode;
            currentRoomName = data.name;
            isCreator = (data.creator === username);
            
            localStorage.setItem('chat_username', username);
            localStorage.setItem('chat_last_room', currentRoomCode);
            connectWebSocket(inviteCode, username);
        } else {
            alert('존재하지 않는 초대 코드입니다.');
        }
    } catch (err) {
        alert('서버 연결에 실패했습니다.');
    }
});

// 방 생성 폼 제출
createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const managerCode = managerCodeInput.value.trim();
    const roomName = newRoomNameInput.value.trim();
    
    if (!username || !managerCode || !roomName) return;
    
    try {
        const res = await fetch('/api/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                manager_code: managerCode,
                room_name: roomName,
                creator: username
            })
        });
        
        if (res.ok) {
            const data = await res.json();
            currentUsername = username;
            currentRoomCode = data.invite_code;
            currentRoomName = roomName;
            isCreator = true;
            
            localStorage.setItem('chat_username', username);
            localStorage.setItem('chat_last_room', currentRoomCode);
            connectWebSocket(currentRoomCode, username);
        } else {
            const errData = await res.json();
            alert(errData.error || '방 생성에 실패했습니다.');
        }
    } catch (err) {
        alert('서버 연결에 실패했습니다.');
    }
});


// 닉네임 변경
renameBtn.addEventListener('click', () => {
    const newName = prompt("새로운 닉네임을 입력하세요:", currentUsername);
    if (newName && newName.trim() !== "" && newName !== currentUsername) {
        currentUsername = newName.trim();
        localStorage.setItem('chat_username', currentUsername);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "rename", new_username: currentUsername }));
        }
    }
});

// 방 관리 버튼 노출 및 모달 제어
manageRoomBtn.addEventListener('click', () => {
    manageInviteCode.textContent = currentRoomCode;
    manageRoomNameInput.value = currentRoomName;
    roomManageModal.classList.remove('hidden');
});

closeManageBtn.addEventListener('click', () => {
    roomManageModal.classList.add('hidden');
});

copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(currentRoomCode).then(() => {
        const originalText = copyCodeBtn.innerHTML;
        copyCodeBtn.innerHTML = '<span>✅</span> 복사 완료!';
        copyCodeBtn.style.background = 'var(--success)';
        setTimeout(() => {
            copyCodeBtn.innerHTML = originalText;
            copyCodeBtn.style.background = 'var(--secondary)';
        }, 2000);
    }).catch(err => {
        alert('초대 코드 복사에 실패했습니다.');
    });
});

manageRenameBtn.addEventListener('click', () => {
    const newName = manageRoomNameInput.value.trim();
    if (newName && newName !== currentRoomName) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "rename_room", new_name: newName }));
        }
        roomManageModal.classList.add('hidden');
    }
});

// 웹소켓 연결
function connectWebSocket(roomCode, username) {
    if ("Notification" in window) {
        if (Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission();
        }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    ws = new WebSocket(`${protocol}//${host}/ws/${roomCode}/${encodeURIComponent(username)}`);

    ws.onopen = () => {
        loginScreen.classList.remove('active');
        chatScreen.classList.add('active');
        messageInput.focus();
        
        // 현재 방 이름을 사이드바 리스트에 추가 (또는 상단 갱신)
        addSavedRoom(roomCode, currentRoomName);
        
        // 방장 여부에 따른 UI 업데이트
        if (isCreator) {
            manageRoomBtn.classList.remove('hidden');
        } else {
            manageRoomBtn.classList.add('hidden');
        }
        
        roomNameDisplay.textContent = currentRoomName;
        
        // 로컬 채팅 기록 복원 (방 별로 격리)
        localHistory = JSON.parse(localStorage.getItem(`chat_history_${roomCode}`)) || [];
        
        chatMessages.innerHTML = '';
        const systemMsg = document.createElement('div');
        systemMsg.className = 'system-message';
        systemMsg.textContent = '환영합니다! 채팅을 시작해보세요.';
        chatMessages.appendChild(systemMsg);
        
        localHistory.forEach(msgData => {
            renderMessage(msgData, false);
        });
        scrollToBottom();
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'system') {
            appendSystemMessage(data.message);
        } else if (data.type === 'chat') {
            appendChatMessage(data);
        } else if (data.type === 'users_count') {
            userCountDisplay.textContent = `온라인: ${data.count}명`;
        } else if (data.type === 'typing') {
            handleTypingIndicator(data.username, data.is_typing);
        } else if (data.type === 'room_name_changed') {
            currentRoomName = data.new_name;
            roomNameDisplay.textContent = currentRoomName;
            
            // 사이드바 이름도 즉시 갱신
            addSavedRoom(roomCode, currentRoomName);
            
            if (!document.hidden) {
                pageTitle.textContent = currentRoomName;
            }
        } else if (data.type === 'image') {
            appendChatMessage(data);
        } else if (data.type === 'reaction') {
            handleReaction(data.msgId, data.emoji);
        } else if (data.type === 'secret_chat') {
            renderMessage(data, true);
        } else if (data.type === 'effect') {
            handleEffect(data.effect, data.sender);
        }
        
        if (data.type === 'chat' || data.type === 'image' || data.type === 'secret_chat' || data.type === 'effect') {
            if (data.sender !== currentUsername) {
                if (document.hidden) playBeep();
                
                if (document.hidden && "Notification" in window && Notification.permission === "granted") {
                    let notiBody = data.message || "새로운 이벤트";
                    if (data.type === 'image') notiBody = "📸 사진을 보냈습니다.";
                    if (data.type === 'secret_chat') notiBody = "🔒 시크릿 메시지를 보냈습니다.";
                    if (data.type === 'effect') notiBody = `✨ ${data.effect} 효과를 보냈습니다!`;
                    
                    new Notification(currentRoomName, {
                        body: `${data.sender}: ${notiBody}`,
                        icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>💬</text></svg>'
                    });
                }
            }
        }
    };

    ws.onclose = () => {
        // 이미 다른 방으로 switch 중일 땐 경고하지 않음
        if(currentRoomCode === roomCode) {
            alert("서버와의 연결이 끊어졌습니다.");
            logout();
        }
    };

    ws.onerror = (error) => {
        console.error("WebSocket Error:", error);
    };
}

// 타이핑 이벤트 감지 및 전송
messageInput.addEventListener('input', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "typing", is_typing: true }));
        
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "typing", is_typing: false }));
            }
        }, 1500);
    }
});

// 타이핑 인디케이터 UI 업데이트
function handleTypingIndicator(username, isTyping) {
    if (isTyping) {
        activeTypers.add(username);
    } else {
        activeTypers.delete(username);
    }

    if (activeTypers.size > 0) {
        const typersArray = Array.from(activeTypers);
        let text = "";
        if (typersArray.length === 1) {
            text = `${typersArray[0]}님이 입력 중입니다...`;
        } else if (typersArray.length === 2) {
            text = `${typersArray[0]}, ${typersArray[1]}님이 입력 중입니다...`;
        } else {
            text = `${typersArray[0]}님 외 ${typersArray.length - 1}명이 입력 중입니다...`;
        }
        typingText.textContent = text;
        typingIndicator.classList.remove('hidden');
    } else {
        typingIndicator.classList.add('hidden');
    }
}

// 시크릿 모드 토글
secretBtn.addEventListener('click', () => {
    isSecretMode = !isSecretMode;
    if (isSecretMode) {
        secretBtn.classList.add('secret-mode-active');
        messageInput.placeholder = "🔒 시크릿 메시지 작성 중 (10초 폭파)...";
    } else {
        secretBtn.classList.remove('secret-mode-active');
        messageInput.placeholder = "메시지 입력, 사진 붙여넣기(Ctrl+V), 드래그...";
    }
});

// 메시지 전송 및 슬래시 명령어 처리
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = messageInput.value.trim();
    if (message && ws && ws.readyState === WebSocket.OPEN) {
        if (message.startsWith('/')) {
            handleSlashCommand(message);
        } else {
            const msgId = 'msg-' + Math.random().toString(36).substr(2, 9);
            const msgType = isSecretMode ? "secret_chat" : "chat";
            ws.send(JSON.stringify({ 
                type: msgType, 
                message: message, 
                msgId: msgId,
                replyTo: replyingTo
            }));
            
            cancelReply();
        }
        messageInput.value = '';
        
        ws.send(JSON.stringify({ type: "typing", is_typing: false }));
        if (typingTimeout) {
            clearTimeout(typingTimeout);
            typingTimeout = null;
        }
    }
});

cancelReplyBtn.addEventListener('click', cancelReply);

function cancelReply() {
    replyingTo = null;
    replyingToContainer.classList.add('hidden');
    messageInput.focus();
}

window.initReply = function(msgId, sender, text) {
    replyingTo = { msgId, sender, text };
    replyingToName.textContent = sender;
    replyingToText.textContent = text.length > 20 ? text.substring(0, 20) + '...' : text;
    replyingToContainer.classList.remove('hidden');
    messageInput.focus();
};

window.scrollToMessage = function(msgId) {
    const targetEl = document.getElementById(msgId);
    if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetEl.classList.add('highlight-msg');
        setTimeout(() => targetEl.classList.remove('highlight-msg'), 1500);
    }
};

function handleSlashCommand(message) {
    const parts = message.split(' ');
    const cmd = parts[0];
    let resultMsg = "";
    
    if (cmd === '/주사위') {
        const num = Math.floor(Math.random() * 6) + 1;
        resultMsg = `[미니게임] 🎲 주사위를 굴려 [ ${num} ]이(가) 나왔습니다!`;
    } else if (cmd === '/사다리') {
        const options = parts.slice(1);
        if (options.length < 2) {
            resultMsg = `[시스템] 사다리 탈 항목을 2개 이상 띄어쓰기로 입력하세요. (예: /사다리 치킨 피자 족발)`;
        } else {
            const picked = options[Math.floor(Math.random() * options.length)];
            resultMsg = `[미니게임] 🪜 사다리 타기 결과: [ ${picked} ] 당첨!`;
        }
    } else if (cmd === '/점메추') {
        const menus = [
            "제육볶음", "김치찌개", "된장찌개", "부대찌개", "국밥", "비빔밥", 
            "뼈해장국", "설렁탕", "돈까스", "떡볶이", "김밥", "보쌈", "냉면",
            "초밥", "라멘", "돈카츠", "우동", "규동(소고기덮밥)", "가츠동", "텐동", "소바",
            "짜장면", "짬뽕", "볶음밥", "마라탕", "마라샹궈", "탕수육", "딤섬",
            "파스타", "피자", "햄버거", "샐러드", "샌드위치", "스테이크", "리조또",
            "팟타이", "쌀국수", "똠얌꿍", "푸팟퐁커리", "나시고랭", "분짜", "반미", "카레"
        ];
        const picked = menus[Math.floor(Math.random() * menus.length)];
        resultMsg = `[미니게임] 🍱 오늘의 점심 추천: [ ${picked} ] 어떠세요?`;
    } else if (cmd === '/동전') {
        const coin = Math.random() < 0.5 ? "앞면 👨‍🦱" : "뒷면 🦅";
        resultMsg = `[미니게임] 🪙 동전 던지기 결과: [ ${coin} ]이(가) 나왔습니다!`;
    } else if (cmd === '/가위바위보') {
        const userChoice = parts[1];
        const rps = ["가위", "바위", "보"];
        if (!userChoice || !rps.includes(userChoice)) {
            resultMsg = `[시스템] '/가위바위보 [가위/바위/보]' 형식으로 입력해주세요.`;
        } else {
            const botChoice = rps[Math.floor(Math.random() * rps.length)];
            let matchResult = "무승부 🤝";
            if (
                (userChoice === "가위" && botChoice === "보") ||
                (userChoice === "바위" && botChoice === "가위") ||
                (userChoice === "보" && botChoice === "바위")
            ) {
                matchResult = "당신의 승리! 🎉";
            } else if (userChoice !== botChoice) {
                matchResult = "당신의 패배... 😭";
            }
            resultMsg = `[미니게임] ✌️✊✋ 나: ${userChoice} vs 봇: ${botChoice} 👉 ${matchResult}`;
        }
    } else if (cmd === '/로또') {
        const lottoNums = [];
        while (lottoNums.length < 6) {
            const num = Math.floor(Math.random() * 45) + 1;
            if (!lottoNums.includes(num)) lottoNums.push(num);
        }
        lottoNums.sort((a, b) => a - b);
        resultMsg = `[미니게임] 🎰 금주의 로또 추천 번호: [ ${lottoNums.join(', ')} ] 대박 기원!`;
    } else if (cmd === '/운세') {
        const fortunes = [
            "오늘은 뭘 해도 되는 날입니다! 로또를 사보세요. 🌟",
            "무난하고 평화로운 하루가 될 것입니다. ☕",
            "조금의 인내가 필요한 하루입니다. 화이팅! 💪",
            "예상치 못한 행운이 찾아올 수 있습니다! 🍀",
            "주변 사람들에게 친절을 베풀면 큰 보답으로 돌아옵니다. 😊",
            "오늘은 이불 밖이 위험합니다. 칼퇴를 권장합니다. 🛌"
        ];
        const picked = fortunes[Math.floor(Math.random() * fortunes.length)];
        resultMsg = `[미니게임] 🔮 오늘의 운세: ${picked}`;
    } else if (cmd === '/러시안룰렛') {
        const bullet = Math.floor(Math.random() * 6) + 1;
        if (bullet === 1) {
            resultMsg = `[미니게임] 🔫 러시안 룰렛 결과: 💥 탕!! 당첨되었습니다... (운수 좋은 날)`;
        } else {
            resultMsg = `[미니게임] 🔫 러시안 룰렛 결과: 찰칵. 휴... 살았습니다. 😌`;
        }
    } else if (cmd === '/흔들기') {
        ws.send(JSON.stringify({ type: "effect", effect: "shake" }));
        return;
    } else if (cmd === '/폭죽') {
        ws.send(JSON.stringify({ type: "effect", effect: "confetti" }));
        return;
    } else {
        resultMsg = `[시스템] 알 수 없는 명령어입니다. (가능: /주사위, /사다리, /점메추, /동전, /가위바위보, /로또, /운세, /러시안룰렛, /흔들기, /폭죽)`;
    }
    
    const msgId = 'msg-' + Math.random().toString(36).substr(2, 9);
    ws.send(JSON.stringify({ type: "chat", message: resultMsg, msgId: msgId }));
}

// 로그아웃 (로비로 가기)
logoutBtn.addEventListener('click', logout);

function logout() {
    if (ws) {
        ws.onclose = null;
        ws.close();
    }
    chatScreen.classList.remove('active');
    loginScreen.classList.add('active');
    roomSidebar.classList.remove('open');
    
    localStorage.removeItem('chat_last_room');
    currentRoomCode = "";
}

// 로컬 기록 지우기 (휴지통 버튼)
clearChatBtn.addEventListener('click', () => {
    if (confirm("내 화면의 모든 대화 기록을 지우시겠습니까?\n(상대방의 화면에서는 지워지지 않습니다.)")) {
        localHistory = [];
        if(currentRoomCode) {
            localStorage.removeItem(`chat_history_${currentRoomCode}`);
        }
        chatMessages.innerHTML = '<div class="system-message">대화 기록이 모두 삭제되었습니다.</div>';
    }
});

function appendSystemMessage(msg) {
    const div = document.createElement('div');
    div.className = 'system-message';
    div.textContent = msg;
    chatMessages.appendChild(div);
    scrollToBottom();
}

function getStringColor(str) {
    if (!str) return 'hsl(0, 0%, 50%)';
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 70%, 75%)`; 
}

function appendChatMessage(data) {
    renderMessage(data, true);
}

function renderMessage(data, saveToLocal) {
    const isSelf = data.sender === currentUsername;
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSelf ? 'self' : 'other'}`;
    
    if (saveToLocal && data.type === 'chat') {
        localHistory.push(data);
        if (localHistory.length > 200) localHistory.shift(); 
        if(currentRoomCode) {
            localStorage.setItem(`chat_history_${currentRoomCode}`, JSON.stringify(localHistory));
        }
    }

    let infoHtml = '';
    const safeSender = escapeHTML(data.sender || 'Unknown');
    if (!isSelf) {
        const nameColor = getStringColor(data.sender);
        const initial = data.sender ? data.sender.charAt(0).toUpperCase() : '?';
        infoHtml = `
            <div class="avatar" style="background-color: ${nameColor}; color: #1e293b; font-weight: bold;">
                ${initial}
            </div>
            <div class="message-info">
                <span class="sender-name" style="color: ${nameColor}">${safeSender}</span>
                <span class="time">${data.time}</span>
            </div>`;
        if (saveToLocal) updateNotificationBadge();
    } else {
        infoHtml = `<div class="message-info">
                        <span class="time">${data.time}</span>
                    </div>`;
    }

    let contentHtml = '';
    const msgIdAttr = data.msgId ? `id="${data.msgId}"` : '';
    const safeMsg = escapeHTML(data.message || '');
    
    let replySnippetHtml = '';
    if (data.replyTo) {
        replySnippetHtml = `
            <div class="replied-snippet" onclick="scrollToMessage('${data.replyTo.msgId}')">
                <span class="replied-sender">${escapeHTML(data.replyTo.sender)}</span>
                <span class="replied-text">${escapeHTML(data.replyTo.text)}</span>
            </div>
        `;
    }
    
    let replyBtnHtml = '';
    if (data.type === 'chat' && data.msgId) {
        const encodedMsg = encodeURIComponent(data.message);
        const encodedSender = encodeURIComponent(data.sender);
        replyBtnHtml = `<button class="reply-btn" title="답장하기" onclick="initReply('${data.msgId}', decodeURIComponent('${encodedSender}'), decodeURIComponent('${encodedMsg}'))">↩️</button>`;
    }
    
    if (data.type === 'image') {
        const imgId = 'img-' + Math.random().toString(36).substr(2, 9);
        contentHtml = `
            ${replySnippetHtml}
            <div id="btn-${imgId}" class="ephemeral-img-btn" onclick="viewEphemeralImage('${imgId}', '${data.data}')">
                📸 사진 확인하기 (20초 후 폭파)
            </div>
            <div id="container-${imgId}" class="ephemeral-img-container hidden" style="display: none; cursor: zoom-in;" onclick="openZoomModal('${data.data}')">
                <img id="view-${imgId}" class="ephemeral-img" src="" alt="첨부 이미지">
                <div id="timer-${imgId}" class="ephemeral-timer">20s</div>
            </div>
            ${replyBtnHtml}
        `;
    } else if (data.type === 'secret_chat') {
        const secretId = 'sec-' + Math.random().toString(36).substr(2, 9);
        const encodedMsg = escapeHTML(data.message);
        contentHtml = `
            ${replySnippetHtml}
            <div id="btn-${secretId}" class="secret-txt-btn" onclick="viewSecretText('${secretId}', '${encodedMsg}')">
                🔒 시크릿 메시지 확인 (10초)
            </div>
            <div id="container-${secretId}" class="secret-text-content" style="display: none;">
                <span id="text-${secretId}"></span>
                <div id="timer-${secretId}" class="ephemeral-timer" style="top: auto; bottom: -10px; right: -10px;">10s</div>
            </div>
            ${replyBtnHtml}
        `;
    } else {
        contentHtml = `
            ${replySnippetHtml}
            <div class="message-bubble" ${msgIdAttr}>${safeMsg}</div>
            ${replyBtnHtml}
        `;
    }

    wrapper.innerHTML = `
        ${infoHtml}
        <div class="message-content-wrapper">
            ${contentHtml}
        </div>
    `;

    chatMessages.appendChild(wrapper);
    
    if (data.type === 'chat' && data.msgId) {
        const bubble = wrapper.querySelector('.message-bubble');
        if (bubble) {
            bubble.addEventListener('dblclick', () => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "reaction", msgId: data.msgId, emoji: "❤️" }));
                }
            });
        }
    }
    
    scrollToBottom();
}

function handleReaction(msgId, emoji) {
    if (!msgId) return;
    const bubble = document.getElementById(msgId);
    if (bubble) {
        let badge = bubble.querySelector('.reaction-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'reaction-badge';
            bubble.appendChild(badge);
        }
        
        const currentText = badge.textContent;
        if (currentText.includes(emoji)) {
            const countMatch = currentText.match(/\d+/);
            const count = countMatch ? parseInt(countMatch[0]) + 1 : 2;
            badge.textContent = `${emoji} ${count}`;
        } else {
            badge.textContent = badge.textContent ? `${badge.textContent} ${emoji}` : emoji;
        }
    }
}

function handleEffect(effect, sender) {
    if (effect === 'shake') {
        document.body.classList.add('shake-animation');
        setTimeout(() => document.body.classList.remove('shake-animation'), 500);
        appendSystemMessage(`🫨 ${sender}님이 채팅방을 흔들었습니다!`);
        if ("vibrate" in navigator) navigator.vibrate(200);
    } else if (effect === 'confetti') {
        createConfetti();
        appendSystemMessage(`🎉 ${sender}님이 폭죽을 터뜨렸습니다!`);
    }
}

function createConfetti() {
    const colors = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6'];
    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti-particle';
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
        confetti.style.opacity = Math.random() + 0.5;
        document.body.appendChild(confetti);
        
        setTimeout(() => confetti.remove(), 4000);
    }
}

window.viewEphemeralImage = function(imgId, base64Data) {
    const btn = document.getElementById(`btn-${imgId}`);
    const container = document.getElementById(`container-${imgId}`);
    const imgView = document.getElementById(`view-${imgId}`);
    const timerDisplay = document.getElementById(`timer-${imgId}`);
    
    btn.style.display = 'none';
    container.style.display = 'inline-block';
    imgView.src = base64Data;
    scrollToBottom();
    
    let timeLeft = 20;
    const interval = setInterval(() => {
        timeLeft--;
        timerDisplay.textContent = `${timeLeft}s`;
        
        if (timeLeft <= 0) {
            clearInterval(interval);
            container.innerHTML = '<div class="message-bubble" style="font-style: italic; color: var(--text-muted);">💥 사진이 폭파되었습니다.</div>';
        }
    }, 1000);
};

window.viewSecretText = function(secretId, decodedMsg) {
    const btn = document.getElementById(`btn-${secretId}`);
    const container = document.getElementById(`container-${secretId}`);
    const textView = document.getElementById(`text-${secretId}`);
    const timerDisplay = document.getElementById(`timer-${secretId}`);
    
    btn.style.display = 'none';
    container.style.display = 'inline-block';
    textView.innerHTML = decodedMsg; 
    scrollToBottom();
    
    let timeLeft = 10;
    const interval = setInterval(() => {
        timeLeft--;
        timerDisplay.textContent = `${timeLeft}s`;
        
        if (timeLeft <= 0) {
            clearInterval(interval);
            container.outerHTML = '<div class="message-bubble" style="font-style: italic; color: var(--text-muted);">💥 메시지가 폭파되었습니다.</div>';
        }
    }, 1000);
};

window.openZoomModal = function(base64Data) {
    zoomedImage.src = base64Data;
    imageZoomModal.classList.remove('hidden');
};

function closeZoomModal() {
    imageZoomModal.classList.add('hidden');
    zoomedImage.src = "";
}

closeZoomBtn.addEventListener('click', closeZoomModal);
imageZoomModal.addEventListener('click', (e) => {
    if (e.target !== zoomedImage) {
        closeZoomModal();
    }
});

document.addEventListener('paste', (e) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        const file = e.clipboardData.files[0];
        if (file.type.startsWith('image/')) {
            e.preventDefault(); 
            handleImageFile(file);
        }
    }
});

attachBtn.addEventListener('click', () => {
    imageUploadInput.click();
});

imageUploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleImageFile(file);
    e.target.value = ''; 
});

chatScreen.addEventListener('dragover', (e) => {
    e.preventDefault();
    dragOverlay.classList.remove('hidden');
});

chatScreen.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (e.relatedTarget === null || !chatScreen.contains(e.relatedTarget)) {
        dragOverlay.classList.add('hidden');
    }
});

chatScreen.addEventListener('drop', (e) => {
    e.preventDefault();
    dragOverlay.classList.add('hidden');
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('image/')) {
            handleImageFile(file);
        } else {
            alert('이미지 파일만 전송 가능합니다.');
        }
    }
});

function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800;
            let width = img.width;
            let height = img.height;

            if (width > MAX_WIDTH) {
                height *= MAX_WIDTH / width;
                width = MAX_WIDTH;
            }
            
            canvas.width = width;
            canvas.height = height;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            const base64String = canvas.toDataURL('image/jpeg', 0.7);
            
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: "image", data: base64String }));
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}
