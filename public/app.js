(() => {
  const chatRoot = document.querySelector("[data-global-chat]");
  const directRoot = document.querySelector("[data-direct-chat]");
  if (!chatRoot && !directRoot) {
    return;
  }

  const socket = io();
  const formatDate = (value) =>
    new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));

  const renderMessage = (container, message, currentUserId, partnerId = null) => {
    if (
      partnerId &&
      !(
        (Number(message.sender_id) === currentUserId &&
          Number(message.recipient_id) === partnerId) ||
        (Number(message.sender_id) === partnerId &&
          Number(message.recipient_id) === currentUserId)
      )
    ) {
      return;
    }

    const article = document.createElement("article");
    article.className =
      "chat-message" +
      (Number(message.user_id || message.sender_id) === currentUserId ? " me" : "");
    article.innerHTML = `
      <header>
        <strong>${message.display_name || message.sender_display_name}</strong>
        <small>${formatDate(message.created_at)}</small>
      </header>
      <div></div>
    `;
    article.querySelector("div").textContent = message.content;
    container.appendChild(article);
    container.scrollTop = container.scrollHeight;
  };

  if (chatRoot) {
    const currentUserId = Number(chatRoot.dataset.currentUserId);
    const form = chatRoot.querySelector("form");
    const input = form.querySelector("textarea");
    const log = chatRoot.querySelector(".chat-log");

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      socket.emit("global:send", { content: input.value });
      input.value = "";
    });

    socket.on("global:new", (message) => {
      renderMessage(log, message, currentUserId);
    });
  }

  if (directRoot) {
    const currentUserId = Number(directRoot.dataset.currentUserId);
    const partnerId = Number(directRoot.dataset.partnerId);
    const form = directRoot.querySelector("form");
    const input = form.querySelector("textarea");
    const log = directRoot.querySelector(".message-log");

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      socket.emit("direct:send", {
        recipientId: partnerId,
        content: input.value,
      });
      input.value = "";
    });

    socket.on("direct:new", (message) => {
      renderMessage(log, message, currentUserId, partnerId);
    });
  }

  socket.on("chat:error", (message) => {
    window.alert(message);
  });
})();
