(function () {
  "use strict";

  const choices = document.querySelectorAll("[data-language-choice]");
  const panels = document.querySelectorAll("[data-language-panel]");
  choices.forEach(function (choice) {
    choice.addEventListener("click", function () {
      const language = choice.dataset.languageChoice;
      panels.forEach(function (panel) {
        panel.hidden = panel.dataset.languagePanel !== language;
      });
      choices.forEach(function (button) {
        button.setAttribute("aria-pressed", String(button === choice));
      });
      document.documentElement.lang = language;
      document.documentElement.dir = language === "ur" ? "rtl" : "ltr";
    });
  });
})();
