import React, { useState, useCallback, useMemo, useRef } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import { io } from 'socket.io-client';

export const WebSocketDemo = () => {
  //   const socket = io('localhost:3000');

  //   console.log('socket:', socket);
  //Public API that will echo messages sent to it back to the client
  const [socketUrl, setSocketUrl] = useState('ws://127.0.0.1:9001');
  const messageHistory = useRef([]);

  const { sendMessage, lastMessage, readyState } = useWebSocket(socketUrl);

  messageHistory.current = useMemo(() => messageHistory.current.concat(lastMessage), [lastMessage]);

  const handleClickChangeSocketUrl = useCallback(() => setSocketUrl('ws://localhost:9001'), []);

  const handleClickSendMessage = useCallback(() => sendMessage('Hello'), []);

  const connectionStatus = {
    [ReadyState.CONNECTING]: 'Connecting',
    [ReadyState.OPEN]: 'Open',
    [ReadyState.CLOSING]: 'Closing',
    [ReadyState.CLOSED]: 'Closed',
    [ReadyState.UNINSTANTIATED]: 'Uninstantiated',
  }[readyState];

  return (
    <div>
      <button onClick={handleClickChangeSocketUrl}>Click Me to change Socket Url</button>
      <button onClick={handleClickSendMessage} disabled={readyState !== ReadyState.OPEN}>
        Click Me to send 'Hello'
      </button>
      <span>The WebSocket is currently {connectionStatus}</span>
      {lastMessage ? <span>Last message: {lastMessage?.data}</span> : null}
      <ul>
        {messageHistory.current.map((message, idx) => (
          <span key={idx}>{message?.data}</span>
        ))}
      </ul>
    </div>
  );
};
