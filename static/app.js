const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username-input');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const chatMessages = document.getElementById('chat-messages');
const logoutBtn = document.getElementById('logout-btn');
const randomNameBtn = document.getElementById('random-name-btn');
const renameBtn = document.getElementById('rename-btn');
const userCountDisplay = document.getElementById('user-count-display');
const typingIndicator = document.getElementById('typing-indicator');
const typingText = document.getElementById('typing-text');
const roomNameDisplay = document.getElementById('room-name-display');
const editRoomNameBtn = document.getElementById('edit-room-name-btn');
const attachBtn = document.getElementById('attach-btn');
const imageUploadInput = document.getElementById('image-upload-input');
const dragOverlay = document.getElementById('drag-overlay');

// 확대 모달 엘리먼트
const imageZoomModal = document.getElementById('image-zoom-modal');
const zoomedImage = document.getElementById('zoomed-image');
const closeZoomBtn = document.getElementById('close-zoom-btn');
const bossKeyOverlay = document.getElementById('boss-key-overlay');
const secretBtn = document.getElementById('secret-btn');

let ws = null;
let currentUsername = '';
let typingTimeout = null;
let activeTypers = new Set();
let currentRoomName = "글로벌 채팅방";
let isSecretMode = false;

// 알림 관련 변수
let unreadCount = 0;
const favicon = document.getElementById('favicon');
const pageTitle = document.getElementById('page-title');
const originalFavicon = favicon.href;

// 화면 포커스 상태 감지하여 알림 초기화
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
        unreadCount = 0;
        pageTitle.textContent = currentRoomName;
        favicon.href = originalFavicon;
    }
});

// 보스 키 (Boss Key) 동작
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
        if (chatScreen.classList.contains('active')) {
            bossKeyOverlay.classList.toggle('hidden');
        }
    }
});

// 파비콘에 붉은 알림 뱃지 그리기
function updateNotificationBadge() {
    if (document.hidden) {
        unreadCount++;
        pageTitle.textContent = `(${unreadCount}) ${currentRoomName}`;
        
        // 캔버스를 생성하여 기존 파비콘 위에 붉은 원과 숫자 그리기
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        
        // 말풍선 이모지 그리기
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💬', 16, 16);
        
        // 붉은 뱃지 그리기
        ctx.beginPath();
        ctx.arc(24, 8, 8, 0, 2 * Math.PI);
        ctx.fillStyle = '#ef4444'; // 붉은색
        ctx.fill();
        
        // 숫자 그리기
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Inter, Arial';
        const displayNum = unreadCount > 9 ? '9+' : unreadCount;
        ctx.fillText(displayNum, 24, 8);
        
        favicon.href = canvas.toDataURL('image/png');
    }
}

// 랜덤 닉네임 생성기
const adjectives = ["행복한", "슬픈", "게으른", "용감한", "수줍은", "배고픈", "심심한", "졸린", "똑똑한", "빠른"];
const nouns = ["다람쥐", "호랑이", "거북이", "고양이", "강아지", "코끼리", "독수리", "펭귄", "팬더", "토끼"];

randomNameBtn.addEventListener('click', () => {
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    usernameInput.value = `${adj} ${noun}`;
});

// 로그인 (채팅방 입장)
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    if (username) {
        currentUsername = username;
        connectWebSocket(username);
    }
});

// 닉네임 변경
renameBtn.addEventListener('click', () => {
    const newName = prompt("새로운 닉네임을 입력하세요:", currentUsername);
    if (newName && newName.trim() !== "" && newName !== currentUsername) {
        currentUsername = newName.trim();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "rename", new_username: currentUsername }));
        }
    }
});

// 채팅방 이름 변경
editRoomNameBtn.addEventListener('click', () => {
    const newRoomName = prompt("새로운 채팅방 이름을 입력하세요:", roomNameDisplay.textContent);
    if (newRoomName && newRoomName.trim() !== "") {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "rename_room", new_name: newRoomName.trim() }));
        }
    }
});

// 웹소켓 연결
function connectWebSocket(username) {
    // 알림 권한 요청 (브라우저 푸시 알림)
    if ("Notification" in window) {
        if (Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission();
        }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    ws = new WebSocket(`${protocol}//${host}/ws/${encodeURIComponent(username)}`);

    ws.onopen = () => {
        loginScreen.classList.remove('active');
        chatScreen.classList.add('active');
        messageInput.focus();
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
            if (!document.hidden) {
                pageTitle.textContent = currentRoomName;
            }
        } else if (data.type === 'image') {
            appendChatMessage(data);
        } else if (data.type === 'reaction') {
            handleReaction(data.msgId, data.emoji);
        } else if (data.type === 'secret_chat') {
            appendChatMessage(data);
        }
        
        // 데스크톱 알림 표시 (내가 보낸 게 아니고 창이 숨겨져 있을 때)
        if (document.hidden && data.type !== 'system' && data.type !== 'users_count' && data.type !== 'typing' && data.type !== 'room_name_changed' && data.type !== 'reaction') {
            if (data.sender !== currentUsername && "Notification" in window && Notification.permission === "granted") {
                let notiBody = data.message;
                if (data.type === 'image') notiBody = "📸 사진을 보냈습니다.";
                if (data.type === 'secret_chat') notiBody = "🔒 시크릿 메시지를 보냈습니다.";
                
                new Notification(currentRoomName, {
                    body: `${data.sender}: ${notiBody}`,
                    icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>💬</text></svg>'
                });
            }
        }
    };

    ws.onclose = () => {
        alert("서버와의 연결이 끊어졌습니다.");
        logout();
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
        
        // 슬래시 명령어 (미니게임) 파싱
        if (message.startsWith('/')) {
            handleSlashCommand(message);
        } else {
            // 일반 메시지 또는 시크릿 메시지 전송
            const msgId = 'msg-' + Math.random().toString(36).substr(2, 9);
            const msgType = isSecretMode ? "secret_chat" : "chat";
            ws.send(JSON.stringify({ type: msgType, message: message, msgId: msgId }));
        }
        messageInput.value = '';
        
        // 타이핑 상태 초기화
        ws.send(JSON.stringify({ type: "typing", is_typing: false }));
        if (typingTimeout) {
            clearTimeout(typingTimeout);
            typingTimeout = null;
        }
    }
});

// 슬래시 명령어 로직
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
            // 한식
            "제육볶음", "김치찌개", "된장찌개", "부대찌개", "국밥", "비빔밥", 
            "뼈해장국", "설렁탕", "돈까스", "떡볶이", "김밥", "보쌈", "냉면",
            // 일식
            "초밥", "라멘", "돈카츠", "우동", "규동(소고기덮밥)", "가츠동", "텐동", "소바",
            // 중식
            "짜장면", "짬뽕", "볶음밥", "마라탕", "마라샹궈", "탕수육", "딤섬",
            // 양식
            "파스타", "피자", "햄버거", "샐러드", "샌드위치", "스테이크", "리조또",
            // 아시안 (태국/베트남/기타)
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
    } else {
        resultMsg = `[시스템] 알 수 없는 명령어입니다. (가능: /주사위, /사다리, /점메추, /동전, /가위바위보, /로또, /운세, /러시안룰렛)`;
    }
    
    // 미니게임 결과를 내 채팅으로 전송
    const msgId = 'msg-' + Math.random().toString(36).substr(2, 9);
    ws.send(JSON.stringify({ type: "chat", message: resultMsg, msgId: msgId }));
}

// 로그아웃 (나가기)
logoutBtn.addEventListener('click', logout);

function logout() {
    if (ws) {
        ws.close();
    }
    chatScreen.classList.remove('active');
    loginScreen.classList.add('active');
    usernameInput.value = '';
    currentUsername = '';
}

// UI 업데이트 함수들
function appendSystemMessage(msg) {
    const div = document.createElement('div');
    div.className = 'system-message';
    div.textContent = msg;
    chatMessages.appendChild(div);
    scrollToBottom();
}

// 닉네임을 기반으로 고유한 HSL 색상 생성 (파스텔톤 계열로 가독성 높임)
function getStringColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 70%, 75%)`; // 밝고 채도 있는 색상
}

function appendChatMessage(data) {
    const isSelf = data.sender === currentUsername;
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSelf ? 'self' : 'other'}`;

    let infoHtml = '';
    if (!isSelf) {
        const nameColor = getStringColor(data.sender);
        infoHtml = `<div class="message-info">
                        <span class="sender-name" style="color: ${nameColor}">${escapeHTML(data.sender)}</span>
                        <span class="time">${data.time}</span>
                    </div>`;
        updateNotificationBadge(); // 다른 사람의 메시지일 때 알림 업데이트
    } else {
        infoHtml = `<div class="message-info">
                        <span class="time">${data.time}</span>
                    </div>`;
    }

    let contentHtml = '';
    const msgIdAttr = data.msgId ? `id="${data.msgId}"` : '';
    
    if (data.type === 'image') {
        // 임시 폭파 사진(Snapchat style) UI 생성
        const imgId = 'img-' + Math.random().toString(36).substr(2, 9);
        contentHtml = `
            <div id="btn-${imgId}" class="ephemeral-img-btn" onclick="viewEphemeralImage('${imgId}', '${data.data}')">
                📸 사진 확인하기 (20초 후 폭파)
            </div>
            <div id="container-${imgId}" class="ephemeral-img-container hidden" style="display: none; cursor: zoom-in;" onclick="openZoomModal('${data.data}')">
                <img id="view-${imgId}" class="ephemeral-img" src="" alt="첨부 이미지">
                <div id="timer-${imgId}" class="ephemeral-timer">20s</div>
            </div>
        `;
    } else if (data.type === 'secret_chat') {
        const secretId = 'sec-' + Math.random().toString(36).substr(2, 9);
        const encodedMsg = escapeHTML(data.message);
        contentHtml = `
            <div id="btn-${secretId}" class="secret-txt-btn" onclick="viewSecretText('${secretId}', '${encodedMsg}')">
                🔒 시크릿 메시지 확인 (10초)
            </div>
            <div id="container-${secretId}" class="secret-text-content" style="display: none;">
                <span id="text-${secretId}"></span>
                <div id="timer-${secretId}" class="ephemeral-timer" style="top: auto; bottom: -10px; right: -10px;">10s</div>
            </div>
        `;
    } else {
        contentHtml = `<div class="message-bubble" ${msgIdAttr}>${escapeHTML(data.message)}</div>`;
    }

    wrapper.innerHTML = `
        ${infoHtml}
        ${contentHtml}
    `;

    chatMessages.appendChild(wrapper);
    
    // 리액션(더블클릭) 이벤트 등록 (일반 메시지인 경우)
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

// 리액션 렌더링 로직
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
        
        // 기존 이모지가 있으면 카운트 증가 또는 추가
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

// 1회성 이미지 보기 로직
window.viewEphemeralImage = function(imgId, base64Data) {
    const btn = document.getElementById(`btn-${imgId}`);
    const container = document.getElementById(`container-${imgId}`);
    const imgView = document.getElementById(`view-${imgId}`);
    const timerDisplay = document.getElementById(`timer-${imgId}`);
    
    // 버튼 숨기고 이미지 표시
    btn.style.display = 'none';
    container.style.display = 'inline-block';
    imgView.src = base64Data;
    scrollToBottom();
    
    // 20초 카운트다운
    let timeLeft = 20;
    const interval = setInterval(() => {
        timeLeft--;
        timerDisplay.textContent = `${timeLeft}s`;
        
        if (timeLeft <= 0) {
            clearInterval(interval);
            // 사진 파기
            container.innerHTML = '<div class="message-bubble" style="font-style: italic; color: var(--text-muted);">💥 사진이 폭파되었습니다.</div>';
        }
    }, 1000);
};

// 1회성 시크릿 텍스트 보기 로직
window.viewSecretText = function(secretId, decodedMsg) {
    const btn = document.getElementById(`btn-${secretId}`);
    const container = document.getElementById(`container-${secretId}`);
    const textView = document.getElementById(`text-${secretId}`);
    const timerDisplay = document.getElementById(`timer-${secretId}`);
    
    btn.style.display = 'none';
    container.style.display = 'inline-block';
    // escapeHTML된 문자열이 넘어오므로 innerHTML을 사용 (XSS 방어됨)
    textView.innerHTML = decodedMsg; 
    scrollToBottom();
    
    let timeLeft = 10;
    const interval = setInterval(() => {
        timeLeft--;
        timerDisplay.textContent = `${timeLeft}s`;
        
        if (timeLeft <= 0) {
            clearInterval(interval);
            // 텍스트 파기
            container.outerHTML = '<div class="message-bubble" style="font-style: italic; color: var(--text-muted);">💥 메시지가 폭파되었습니다.</div>';
        }
    }, 1000);
};

// 이미지 확대 모달 제어
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

// --- 드래그 앤 드롭 및 이미지 전송 로직 ---

// 클립보드 복붙(Ctrl+V) 이벤트 처리
document.addEventListener('paste', (e) => {
    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
        const file = e.clipboardData.files[0];
        if (file.type.startsWith('image/')) {
            // 메시지 입력창에 포커스가 있으면 텍스트 입력 방지(이미지가 전송되므로)
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
    e.target.value = ''; // 동일 파일 재선택 가능하게 리셋
});

// 드래그 이벤트 처리
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
    // 캔버스를 이용해 이미지 압축 (최대 폭 800px)
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
            
            // jpeg 품질 0.7로 압축하여 base64 추출
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
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}
