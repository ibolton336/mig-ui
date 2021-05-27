import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import useSocket from 'use-socket.io-client';

export const WebSocketDemo = () => {
  //   const socket = io('localhost:3000');

  //   console.log('socket:', socket);
  //Public API that will echo messages sent to it back to the client
  // console.log('process.env', process.env);
  // console.log('port', process.env.PORT);
  // console.log('express port', process.env.EXPRESS_PORT);
  // const exampleSocket = new WebSocket(`ws://127.0.0.1:${process.env.PORT || 9001}`, 'protocolOne');

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
  // const eventList = lastMessage?.data && JSON.parse(lastMessage.data);

  useEffect(() => {
    // exampleSocket.send("Here's some text that the server is urgently awaiting!");
    const msg = {
      type: 'GET_EVENTS',
      date: Date.now(),
    };
    if (connectionStatus === 'Open') {
      sendJsonMessage(msg);
    }
    // Send the msg object as a JSON-formatted string.
    // exampleSocket.send(JSON.stringify(msg));

    // sendMessage('events');
    // sendJsonMessage()
  }, [connectionStatus]);
  // exampleSocket.onmessage = function (event) {
  //   console.log(event.data);
  // };

  // console.log('client side', lastMessage);
  // console.log('client side parsed', lastMessage?.data && JSON.parse(lastMessage?.data));

  // const handleClickChangeSocketUrl = useCallback(() => setSocketUrl('ws://localhost:9001'), []);

  // const handleClickSendMessage = useCallback(() => sendMessage('events'), []);

  return (
    <div>
      {/* <button onClick={handleClickChangeSocketUrl}>Click Me to change Socket Url</button> */}
      {/* <button onClick={handleClickSendMessage} disabled={readyState !== ReadyState.OPEN}>
        Click Me to update events'
      </button> */}
      <div>The WebSocket is currently {connectionStatus}</div>
      {lastMessage ? <span>Last message: {lastMessage?.data}</span> : null}
      {/* {eventList?.items?.length > 0 ? (
        <>
          {eventList?.items?.map((item, idx) => (
            <div key={idx}>{item?.message}</div>
          ))}
        </>
      ) : (
        <>
          <div>No events found</div>
        </>
      )} */}
      <ul></ul>
    </div>
  );
};
