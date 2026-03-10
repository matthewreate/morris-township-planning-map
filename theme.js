(() => {
  const STORAGE_KEY = "morris-township-theme";
  const DARK = "dark";
  const LIGHT = "light";
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function getStoredTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_error) {
      return null;
    }
  }

  function getPreferredTheme() {
    return LIGHT;
  }

  function getTheme() {
    const storedTheme = getStoredTheme();
    return storedTheme === DARK || storedTheme === LIGHT ? storedTheme : getPreferredTheme();
  }

  function applyTheme(theme, persist = true) {
    const nextTheme = theme === DARK ? DARK : LIGHT;
    document.documentElement.dataset.theme = nextTheme;

    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, nextTheme);
      } catch (_error) {
        // Ignore storage failures in static preview environments.
      }
    }

    window.dispatchEvent(
      new CustomEvent("morris-theme-change", {
        detail: { theme: nextTheme },
      }),
    );

    syncThemeButtons(nextTheme);
  }

  function syncThemeButtons(theme) {
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const isDark = theme === DARK;
      button.setAttribute("aria-pressed", String(isDark));
      button.dataset.theme = theme;

      const label = button.querySelector("[data-theme-label]");
      if (label) {
        label.textContent = isDark ? "Light mode" : "Dark mode";
      }
    });
  }

  function toggleTheme() {
    applyTheme(getTheme() === DARK ? LIGHT : DARK);
  }

  function bindThemeButtons() {
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", toggleTheme);
    });
    syncThemeButtons(getTheme());
  }

  document.addEventListener("DOMContentLoaded", bindThemeButtons);

  mediaQuery.addEventListener("change", () => {
    if (!getStoredTheme()) {
      applyTheme(getPreferredTheme(), false);
    }
  });

  window.morrisTheme = {
    getTheme,
    applyTheme,
    toggleTheme,
  };
})();
