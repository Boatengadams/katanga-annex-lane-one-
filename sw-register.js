if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed", err);
    });
  });
}

const CLICK_FEEDBACK_SELECTOR = "button, input[type='submit']";

const applyClickFeedback = (target) => {
  if (!target || typeof target.classList?.add !== "function") return;
  target.classList.add("is-click-feedback");
  window.setTimeout(() => {
    target.classList.remove("is-click-feedback");
  }, 160);
};

document.addEventListener("click", (event) => {
  const clickable = event.target.closest(CLICK_FEEDBACK_SELECTOR);
  if (!clickable || clickable.disabled) return;
  applyClickFeedback(clickable);
});
