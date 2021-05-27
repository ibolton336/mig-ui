import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';

export const WebSocketDemo = () => {
  const [socketUrl, setSocketUrl] = useState(`ws://127.0.0.1:${process.env.PORT || 9001}`);
  const messageHistory = useRef([]);
  const {
    sendMessage,
    sendJsonMessage,
    lastMessage,
    lastJsonMessage,
    readyState,
    getWebSocket,
  } = useWebSocket(socketUrl, {
    onOpen: () => console.log('opened'),
    //Will attempt to reconnect on all close events, such as server shutting down
    shouldReconnect: (closeEvent) => true,
  });

  messageHistory.current = useMemo(() => messageHistory.current.concat(lastMessage), [lastMessage]);
  const connectionStatus = {
    [ReadyState.CONNECTING]: 'Connecting',
    [ReadyState.OPEN]: 'Open',
    [ReadyState.CLOSING]: 'Closing',
    [ReadyState.CLOSED]: 'Closed',
    [ReadyState.UNINSTANTIATED]: 'Uninstantiated',
  }[readyState];
  useEffect(() => {
    const msg = {
      type: 'GET_EVENTS',
      date: Date.now(),
    };
    if (connectionStatus === 'Open') {
      sendJsonMessage(msg);
    }
  }, [connectionStatus]);
  return (
    <div>
      <div>The WebSocket is currently {connectionStatus}</div>
      {lastJsonMessage ? <span>Last message: {lastJsonMessage?.data}</span> : null}
      <ul></ul>
    </div>
  );
};
