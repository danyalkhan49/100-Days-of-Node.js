(function () {
  "use strict";

  const form = document.getElementById("support-form");
  if (!form) return;

  const message = document.getElementById("support-message-status");
  const ticketsSection = document.getElementById("my-tickets-section");
  const ticketsContainer = document.getElementById("my-tickets");
  const loadMoreButton = document.getElementById("load-more-tickets");
  let ticketPage = 1;
  let ticketPages = 1;

  function textElement(tagName, text, className) {
    const element = document.createElement(tagName);
    element.textContent = text || "";
    if (className) element.className = className;
    return element;
  }

  function renderTicket(ticket) {
    const card = document.createElement("article");
    card.className = "request-card";

    const top = document.createElement("div");
    top.className = "request-card-top";
    top.append(
      textElement("span", ticket.category, "mini-label"),
      textElement("span", ticket.status, "badge " + window.LifeLink.statusClass(ticket.status))
    );
    card.append(top);

    const date = document.createElement("p");
    date.className = "request-card-foot";
    date.textContent = "Submitted " + window.LifeLink.formatDate(ticket.createdAt, true);
    card.append(date, textElement("p", ticket.message));

    if (ticket.adminReply) {
      const reply = document.createElement("div");
      reply.className = "notice";
      reply.append(
        textElement("strong", "Support reply"),
        textElement("p", ticket.adminReply),
        textElement("small", ticket.repliedAt
          ? "Replied " + window.LifeLink.formatDate(ticket.repliedAt, true)
          : "")
      );
      card.append(reply);
    }
    return card;
  }

  async function loadTickets(append) {
    if (!window.LifeLink.token()) {
      ticketsSection.hidden = true;
      return;
    }

    ticketsSection.hidden = false;
    if (!append) {
      ticketPage = 1;
      ticketsContainer.replaceChildren();
      window.LifeLink.loading(ticketsContainer, "Loading your support requests…");
    }

    try {
      const result = await window.LifeLink.request(
        "/api/support/tickets/mine?page=" + ticketPage + "&limit=10"
      );
      const data = window.LifeLink.listFrom(result);
      if (!append) ticketsContainer.replaceChildren();
      if (data.length === 0 && !append) {
        window.LifeLink.showEmpty(
          ticketsContainer,
          "No support requests yet",
          "Requests you submit while signed in will appear here."
        );
      } else {
        data.forEach(function (ticket) {
          ticketsContainer.append(renderTicket(ticket));
        });
      }
      ticketPages = result.pagination && Number.isInteger(result.pagination.totalPages)
        ? result.pagination.totalPages
        : 1;
      loadMoreButton.hidden = ticketPage >= ticketPages;
      ticketsContainer.setAttribute("aria-busy", "false");
    } catch (error) {
      loadMoreButton.hidden = true;
      window.LifeLink.showError(ticketsContainer, error.message);
    }
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const fields = new FormData(form);
    const payload = {
      name: String(fields.get("name") || "").trim(),
      email: String(fields.get("email") || "").trim(),
      phone: String(fields.get("phone") || "").trim(),
      category: String(fields.get("category") || ""),
      message: String(fields.get("message") || "").trim(),
      website: String(fields.get("website") || "").trim()
    };

    if (!window.LifeLink.token() && !payload.email && !payload.phone) {
      window.LifeLink.setFormMessage(
        message,
        "Provide an email address or phone number so support can respond.",
        "error"
      );
      return;
    }

    window.LifeLink.setFormMessage(message, "", "error");
    window.LifeLink.setBusy(form, true, "Sending…");
    try {
      const result = await window.LifeLink.request("/api/support/tickets", {
        method: "POST",
        body: payload
      });
      window.LifeLink.setFormMessage(
        message,
        result.message || "Your support request has been received.",
        "success"
      );
      form.reset();
      await loadTickets(false);
    } catch (error) {
      window.LifeLink.setFormMessage(message, error.message, "error");
    } finally {
      window.LifeLink.setBusy(form, false);
    }
  });

  loadMoreButton.addEventListener("click", async function () {
    if (ticketPage >= ticketPages) return;
    ticketPage += 1;
    await loadTickets(true);
  });

  loadTickets(false);
})();
