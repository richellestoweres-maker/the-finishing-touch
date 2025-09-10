<script>
// The Finishing Touch — Site-wide Chat (nav + FAQs + terms refs, intake-gated, persistent)
// Include on every page: <script src="ftt-chat.js" defer></script>
(function(){
  if (window.__FTT_CHAT_READY__) return; window.__FTT_CHAT_READY__ = true;

  // ---- FLAGS (unchanged) ----
  const INTAKE_UNLOCK_KEY = "ftt_intake_ok";          // set after intake submit
  const ESTABLISHED_KEY   = "ftt_client_established"; // set on successful login (profile portal)

  // ---- CONFIG: update URLs/anchors to match your files ----
  const CFG = {
    timezone: "America/Chicago",
    email: "contact.thefinishingtouch.tx@gmail.com",
    messenger: "https://m.me/thefinishingtouch.tx",
    profileUrl: "profile.html", // returning client portal
    pages: {
      home: "index.html",
      services: "index.html#services",
      about: "index.html#about",
      contact: "index.html#contact",
      terms: "terms.html#client-terms",
      privacy: "terms.html#privacy",
      policies: "terms.html#policies"
    },
    intakes: {
      cleaning:   "intake-cleaning.html",
      organizing: "intake-organizing.html",
      decor:      "intake-decor.html",
      holiday:    "intake-holiday.html"
    }
  };

  // ---- Tiny styles (kept minimal) ----
  const CSS = `
  #ftt-chat-launcher{position:fixed;right:18px;bottom:18px;width:52px;height:52px;border-radius:50%;
    background:#2a2624;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;
    box-shadow:0 8px 24px rgba(0,0,0,.18);z-index:9999;font-size:22px}
  #ftt-chat{position:fixed;right:18px;bottom:84px;width:320px;max-width:90vw;background:#fff;border-radius:16px;
    box-shadow:0 18px 48px rgba(0,0,0,.18);z-index:9999;display:flex;flex-direction:column;overflow:hidden}
  .ftt-chat-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #eee;background:#fbf8f4}
  .ftt-title{font-weight:700}.ftt-subtitle{font-size:.85rem;opacity:.8}
  .ftt-close{background:none;border:none;font-size:20px;cursor:pointer;line-height:1}
  .ftt-thread{height:360px;overflow:auto;padding:10px;background:#fff}
  .ftt-bubble{max-width:82%;padding:8px 10px;border-radius:12px;margin:6px 0;line-height:1.35}
  .ftt-bubble.bot{background:#f5efe8;color:#2a2624;border-top-left-radius:4px}
  .ftt-bubble.me{background:#2a2624;color:#fff;margin-left:auto;border-top-right-radius:4px}
  .ftt-inputbar{display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff}
  .ftt-inputbar input{flex:1;border:1px solid #e6ded6;border-radius:10px;padding:8px}
  .ftt-inputbar button{border:0;background:#2a2624;color:#fff;border-radius:10px;padding:8px 12px;cursor:pointer}
  .ftt-quick{display:flex;flex-wrap:wrap;gap:6px;padding:10px;border-top:1px solid #eee;background:#fff}
  .ftt-quick button{border:1px solid #e6ded6;background:#fff;border-radius:999px;padding:6px 10px;font-size:.85rem;cursor:pointer}
  .ftt-card{border:1px solid #e6ded6;border-radius:12px;padding:10px;margin:8px 0;background:#fff}
  .ftt-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
  .ftt-actions button{border:0;background:#2a2624;color:#fff;border-radius:999px;padding:6px 10px;cursor:pointer}
  .ftt-actions a{display:inline-block;text-decoration:none;border:1px solid #2a2624;color:#2a2624;border-radius:999px;padding:6px 10px}
  `;
  (function injectCSS(){ if (!document.getElementById("ftt-chat-css")){ const s=document.createElement("style"); s.id="ftt-chat-css"; s.textContent=CSS; document.head.appendChild(s); }})();

  // ---- DOM inject ----
  function ensureDOM(){
    if (!document.getElementById("ftt-chat-launcher")){
      const l=document.createElement("div"); l.id="ftt-chat-launcher"; l.setAttribute("role","button"); l.setAttribute("aria-label","Open chat"); l.textContent="💬"; document.body.appendChild(l);
    }
    if (!document.getElementById("ftt-chat")){
      const p=document.createElement("div"); p.id="ftt-chat"; p.setAttribute("aria-live","polite"); p.hidden=true;
      p.innerHTML=`
        <div class="ftt-chat-header">
          <div><div class="ftt-title">The Finishing Touch</div><div class="ftt-subtitle">AI Concierge • human on request</div></div>
          <button class="ftt-close" aria-label="Close chat">×</button>
        </div>
        <div id="ftt-thread" class="ftt-thread"></div>
        <form id="ftt-inputbar" class="ftt-inputbar" autocomplete="off">
          <input id="ftt-input" name="message" type="text" placeholder="Ask for help, pricing, or terms…" required />
          <button class="ftt-send" type="submit">Send</button>
        </form>
        <div class="ftt-quick"></div>
      `;
      document.body.appendChild(p);
    }
  }

  // ---- Persistence ----
  const LS_THREAD="ftt_chat_thread_v2", LS_OP_
