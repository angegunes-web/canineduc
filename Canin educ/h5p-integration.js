const H5P_RESIZER_SRC = "https://h5p.org/sites/all/modules/h5p/library/js/h5p-resizer.js";

const FALLBACK_CONFIG = [
        {
                id: "demo-education-positive",
                title: "Quiz exemple · Éducation positive",
                description: "Exemple H5P de démonstration. Remplacez cette ressource par votre propre questionnaire.",
                embedUrl: "https://h5p.org/h5p/embed/1099",
                order: 1,
                readyMessage: "Le QCM d'exemple est prêt à être lancé.",
                buttonLabel: "Lancer le QCM d'exemple"
        },
        {
                id: "demo-psychologie-canine",
                title: "Quiz exemple · Psychologie canine",
                description: "Remplacez l'URL H5P par le QCM correspondant à votre deuxième module.",
                embedUrl: "https://h5p.org/h5p/embed/1100",
                order: 2,
                buttonLabel: "Tester le quiz d'exemple"
        },
        {
                id: "demo-conditionnement",
                title: "Quiz exemple · Conditionnement",
                description: "Questionnaire fictif à personnaliser pour vos contenus pratiques.",
                embedUrl: "https://h5p.org/h5p/embed/1101",
                order: 3,
                buttonLabel: "Ouvrir le QCM d'exemple"
        }
];

function sanitizeConfig(entries, { fallback = false } = {}) {
        if (!Array.isArray(entries)) {
                return [];
        }

        return entries
                .map((entry, index) => {
                        if (!entry || typeof entry !== "object") {
                                return null;
                        }

                        const embedUrl = typeof entry.embedUrl === "string" ? entry.embedUrl.trim() : "";

                        if (!embedUrl) {
                                return null;
                        }

                        const fallbackPrefix = fallback ? "demo-" : "";
                        const id = entry.id ? String(entry.id) : `${fallbackPrefix}quiz-${index + 1}`;
                        const title = entry.title ? String(entry.title) : `Quiz ${index + 1}`;
                        const description = entry.description ? String(entry.description) : "";
                        const buttonLabel = entry.buttonLabel ? String(entry.buttonLabel) : "Lancer le QCM";
                        const manualUnlockLabel = entry.manualUnlockLabel ? String(entry.manualUnlockLabel) : "J'ai terminé la vidéo";
                        const unlockMessage = entry.unlockMessage ? String(entry.unlockMessage) : "Terminez la vidéo pour débloquer le QCM.";
                        const readyMessage = entry.readyMessage ? String(entry.readyMessage) : "Vous pouvez maintenant lancer le QCM.";
                        const overlayDescription = entry.overlayDescription ? String(entry.overlayDescription) : description;
                        const selector = typeof entry.selector === "string" ? entry.selector : null;
                        const attachTo = [];

                        if (Array.isArray(entry.attachTo)) {
                                entry.attachTo.forEach((selectorValue) => {
                                        if (typeof selectorValue === "string" && selectorValue.trim()) {
                                                attachTo.push(selectorValue.trim());
                                        }
                                });
                        } else if (typeof entry.attachTo === "string" && entry.attachTo.trim()) {
                                attachTo.push(entry.attachTo.trim());
                        }

                        const order = typeof entry.order === "number" && Number.isFinite(entry.order) ? entry.order : index;
                        const allowMultiple = entry.allowMultiple === true;
                        const autoUnlock = entry.autoUnlock === true;

                        return {
                                id,
                                title,
                                description,
                                embedUrl,
                                selector,
                                attachTo,
                                order,
                                allowMultiple,
                                buttonLabel,
                                manualUnlockLabel,
                                unlockMessage,
                                readyMessage,
                                overlayDescription,
                                autoUnlock
                        };
                })
                .filter(Boolean)
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function buildConfigStore(initialEntries) {
        let items = sanitizeConfig(initialEntries);
        let usingFallback = false;

        if (!items.length) {
            items = sanitizeConfig(FALLBACK_CONFIG, { fallback: true });
            usingFallback = items.length > 0;
        }

        if (usingFallback) {
                console.info("[H5P] Aucun QCM personnalisé détecté. Des questionnaires d'exemple H5P sont chargés par défaut. Mettez à jour window.h5pQuizConfig pour utiliser vos propres contenus.");
        } else if (!items.length) {
                console.warn("[H5P] Aucun QCM H5P valide n'a été configuré. Ajoutez vos contenus dans window.h5pQuizConfig ou utilisez les attributs data-h5p-embed-url sur vos vidéos.");
        }

        return {
                items,
                usingFallback,
                byId: new Map(items.map((item) => [item.id, item])),
                usage: new Map()
        };
}

const configState = buildConfigStore(window.h5pQuizConfig);
const attachments = new WeakSet();
const overlayCache = new Map();
let activeOverlay = null;
let previouslyFocusedElement = null;
let scanScheduled = false;

function matchesSelector(element, selector) {
        if (!(element instanceof Element)) {
                return false;
        }

        try {
                return element.matches(selector);
        } catch (error) {
                console.warn(`[H5P] Sélecteur CSS invalide ignoré: ${selector}`, error);
                return false;
        }
}

function getInlineQuizConfig(mediaElement) {
        if (!(mediaElement instanceof Element)) {
                return null;
        }

        const embedUrl = mediaElement.dataset.h5pEmbedUrl;

        if (!embedUrl) {
                return null;
        }

        const inlineConfig = sanitizeConfig([
                {
                        id: mediaElement.dataset.h5pQuiz || `inline-${embedUrl}`,
                        title: mediaElement.dataset.h5pTitle || mediaElement.getAttribute("aria-label") || "Quiz H5P",
                        description: mediaElement.dataset.h5pDescription || "",
                        embedUrl,
                        buttonLabel: mediaElement.dataset.h5pButtonLabel,
                        manualUnlockLabel: mediaElement.dataset.h5pManualLabel,
                        unlockMessage: mediaElement.dataset.h5pUnlockMessage,
                        readyMessage: mediaElement.dataset.h5pReadyMessage,
                        overlayDescription: mediaElement.dataset.h5pOverlayDescription,
                        allowMultiple: mediaElement.dataset.h5pAllowMultiple === "true",
                        autoUnlock: mediaElement.dataset.h5pAutoUnlock === "true"
                }
        ]);

        return inlineConfig[0] || null;
}

function isQuizAlreadyUsed(quiz) {
        if (!quiz) {
                return false;
        }

        if (quiz.allowMultiple) {
                return false;
        }

        return (configState.usage.get(quiz.id) || 0) > 0;
}

function markQuizUsed(quiz) {
        if (!quiz) {
                return;
        }

        const currentCount = configState.usage.get(quiz.id) || 0;
        configState.usage.set(quiz.id, currentCount + 1);
}

function findQuizForElement(mediaElement) {
        if (!(mediaElement instanceof Element)) {
                return null;
        }

        const inlineQuiz = getInlineQuizConfig(mediaElement);

        if (inlineQuiz) {
                return inlineQuiz;
        }

        const datasetId = mediaElement.dataset.h5pQuiz;

        if (datasetId && configState.byId.has(datasetId)) {
                const quiz = configState.byId.get(datasetId);

                if (!isQuizAlreadyUsed(quiz) || quiz.allowMultiple) {
                        return quiz;
                }
        }

        const selectorMatch = configState.items.find((quiz) => quiz.selector && matchesSelector(mediaElement, quiz.selector) && (!isQuizAlreadyUsed(quiz) || quiz.allowMultiple));

        if (selectorMatch) {
                return selectorMatch;
        }

        const containerMatch = configState.items.find((quiz) =>
                quiz.attachTo.length > 0 && quiz.attachTo.some((selector) => mediaElement.closest(selector)) && (!isQuizAlreadyUsed(quiz) || quiz.allowMultiple)
        );

        if (containerMatch) {
                return containerMatch;
        }

        const orderedQuiz = configState.items.find((quiz) => !isQuizAlreadyUsed(quiz) || quiz.allowMultiple);

        return orderedQuiz || null;
}

function ensureResizerLoaded() {
        if (document.querySelector(`script[src="${H5P_RESIZER_SRC}"]`)) {
                return;
        }

        const script = document.createElement("script");
        script.src = H5P_RESIZER_SRC;
        script.charset = "UTF-8";
        script.dataset.h5pResizer = "true";
        script.async = true;
        document.head.appendChild(script);
}

function closeOverlay(overlay) {
        if (!overlay) {
                return;
        }

        overlay.classList.remove("is-visible");

        if (activeOverlay === overlay) {
                activeOverlay = null;
                document.body.classList.remove("h5p-quiz-overlay-open");

                if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === "function") {
                        previouslyFocusedElement.focus({ preventScroll: true });
                }

                previouslyFocusedElement = null;
        }
}

function getOverlayForQuiz(quiz) {
        if (!quiz) {
                return null;
        }

        if (!overlayCache.has(quiz.id)) {
                const overlay = document.createElement("div");
                overlay.className = "h5p-quiz-overlay";
                overlay.setAttribute("role", "dialog");
                overlay.setAttribute("aria-modal", "true");
                overlay.dataset.quizId = quiz.id;

                const dialog = document.createElement("div");
                dialog.className = "h5p-quiz-overlay__dialog";
                dialog.setAttribute("role", "document");
                dialog.setAttribute("tabindex", "-1");

                const header = document.createElement("div");
                header.className = "h5p-quiz-overlay__header";

                const title = document.createElement("h3");
                title.className = "h5p-quiz-overlay__title";
                title.textContent = quiz.title;

                const closeButton = document.createElement("button");
                closeButton.type = "button";
                closeButton.className = "h5p-quiz-overlay__close";
                closeButton.setAttribute("aria-label", "Fermer le QCM");
                closeButton.innerHTML = "&times;";

                const body = document.createElement("div");
                body.className = "h5p-quiz-overlay__body";

                if (quiz.overlayDescription) {
                        const description = document.createElement("p");
                        description.className = "h5p-quiz-overlay__description";
                        description.textContent = quiz.overlayDescription;
                        body.appendChild(description);
                }

                const frameWrapper = document.createElement("div");
                frameWrapper.className = "h5p-quiz-overlay__frame-wrapper";

                const iframe = document.createElement("iframe");
                iframe.className = "h5p-quiz-overlay__frame";
                iframe.src = quiz.embedUrl;
                iframe.title = quiz.title;
                iframe.loading = "lazy";
                iframe.allow = "autoplay; fullscreen";

                frameWrapper.appendChild(iframe);
                body.appendChild(frameWrapper);
                header.appendChild(title);
                header.appendChild(closeButton);
                dialog.appendChild(header);
                dialog.appendChild(body);
                overlay.appendChild(dialog);

                overlay.addEventListener("click", (event) => {
                        if (event.target === overlay) {
                                closeOverlay(overlay);
                        }
                });

                overlay.addEventListener("keydown", (event) => {
                        if (event.key === "Escape") {
                                closeOverlay(overlay);
                        }
                });

                closeButton.addEventListener("click", () => closeOverlay(overlay));

                document.body.appendChild(overlay);
                ensureResizerLoaded();
                overlayCache.set(quiz.id, overlay);
        }

        return overlayCache.get(quiz.id) || null;
}

function openOverlay(overlay, trigger) {
        if (!overlay) {
                return;
        }

        previouslyFocusedElement = trigger || document.activeElement;
        overlay.classList.add("is-visible");
        document.body.classList.add("h5p-quiz-overlay-open");
        activeOverlay = overlay;

        const dialog = overlay.querySelector(".h5p-quiz-overlay__dialog");

        if (dialog) {
                dialog.focus({ preventScroll: false });
        }
}

function createLaunchInterface(mediaElement, quiz) {
        if (!(mediaElement instanceof Element) || !quiz) {
                return null;
        }

        const container = document.createElement("div");
        container.className = "h5p-quiz-launch";
        container.dataset.quizId = quiz.id;

        const badge = document.createElement("span");
        badge.className = "h5p-quiz-launch__badge";
        badge.textContent = "QCM H5P";

        const status = document.createElement("p");
        status.className = "h5p-quiz-launch__status";
        status.textContent = quiz.unlockMessage;

        const actions = document.createElement("div");
        actions.className = "h5p-quiz-launch__actions";

        const button = document.createElement("button");
        button.type = "button";
        button.className = "h5p-quiz-launch__button";
        button.textContent = quiz.buttonLabel;
        button.disabled = !quiz.autoUnlock;

        let manualButton = null;

        const unlock = () => {
                if (!button.disabled) {
                        return;
                }

                button.disabled = false;
                container.classList.add("h5p-quiz-launch--ready");
                status.textContent = quiz.readyMessage;

                if (manualButton) {
                        manualButton.remove();
                        manualButton = null;
                }
        };

        actions.appendChild(button);

        if (quiz.description) {
                const description = document.createElement("p");
                description.className = "h5p-quiz-launch__description";
                description.textContent = quiz.description;
                container.appendChild(description);
        }

        container.prepend(badge);
        container.appendChild(status);
        container.appendChild(actions);

        button.addEventListener("click", () => {
                if (button.disabled) {
                        return;
                }

                const overlay = getOverlayForQuiz(quiz);
                openOverlay(overlay, button);
        });

        if (quiz.autoUnlock) {
                unlock();
        } else if (mediaElement.tagName === "VIDEO") {
                mediaElement.addEventListener("ended", unlock);
                mediaElement.addEventListener("timeupdate", () => {
                        if (!button.disabled) {
                                return;
                        }

                        const duration = Number(mediaElement.duration);

                        if (Number.isFinite(duration) && duration > 0 && duration - mediaElement.currentTime <= 0.4) {
                                unlock();
                        }
                });
        } else {
                manualButton = document.createElement("button");
                manualButton.type = "button";
                manualButton.className = "h5p-quiz-launch__manual";
                manualButton.textContent = quiz.manualUnlockLabel;
                manualButton.addEventListener("click", () => unlock());
                actions.appendChild(manualButton);
        }

        mediaElement.insertAdjacentElement("afterend", container);

        return container;
}

function attachToMedia(mediaElement) {
        if (!(mediaElement instanceof Element)) {
                return;
        }

        if (attachments.has(mediaElement)) {
                return;
        }

        const quiz = findQuizForElement(mediaElement);

        if (!quiz) {
                return;
        }

        const interfaceElement = createLaunchInterface(mediaElement, quiz);

        if (!interfaceElement) {
                return;
        }

        attachments.add(mediaElement);
        markQuizUsed(quiz);
}

function collectCandidates() {
        const candidates = new Set();

        document.querySelectorAll("video").forEach((video) => candidates.add(video));

        document.querySelectorAll("[data-h5p-media]").forEach((element) => {
                if (element.matches("video,iframe")) {
                        candidates.add(element);
                } else {
                        const nestedMedia = element.querySelector("video,iframe");

                        if (nestedMedia) {
                                candidates.add(nestedMedia);
                        }
                }
        });

        document.querySelectorAll("[data-h5p-quiz], [data-h5p-embed-url]").forEach((element) => {
                if (element.matches("video,iframe")) {
                        candidates.add(element);
                } else {
                        const nested = element.querySelector("video,iframe,[data-h5p-embed-url]");

                        if (nested) {
                                candidates.add(nested);
                        }
                }
        });

        configState.items.forEach((quiz) => {
                if (quiz.selector) {
                        document.querySelectorAll(quiz.selector).forEach((element) => {
                                if (element.matches("video,iframe")) {
                                        candidates.add(element);
                                } else {
                                        const nested = element.querySelector("video,iframe,[data-h5p-media]");

                                        if (nested) {
                                                candidates.add(nested);
                                        }
                                }
                        });
                }

                quiz.attachTo.forEach((selector) => {
                        document.querySelectorAll(selector).forEach((element) => {
                                if (element.matches("video,iframe")) {
                                        candidates.add(element);
                                } else {
                                        const nested = element.querySelector("video,iframe,[data-h5p-media]");

                                        if (nested) {
                                                candidates.add(nested);
                                        }
                                }
                        });
                });
        });

        return Array.from(candidates);
}

function scanForMedia() {
        collectCandidates().forEach((element) => attachToMedia(element));
}

function scheduleScan(immediate = false) {
        if (immediate) {
                scanScheduled = false;
                scanForMedia();
                return;
        }

        if (scanScheduled) {
                return;
        }

        scanScheduled = true;

        requestAnimationFrame(() => {
                scanScheduled = false;
                scanForMedia();
        });
}

function observeDomChanges() {
        const observer = new MutationObserver(() => scheduleScan());

        if (document.body) {
                observer.observe(document.body, { childList: true, subtree: true });
        }
}

function patchHistoryMethods() {
        ["pushState", "replaceState"].forEach((methodName) => {
                const original = history[methodName];

                if (typeof original !== "function") {
                        return;
                }

                history[methodName] = function patchedHistoryMethod(...args) {
                        const result = original.apply(this, args);
                        scheduleScan();
                        return result;
                };
        });

        window.addEventListener("popstate", () => scheduleScan());
        window.addEventListener("hashchange", () => scheduleScan());
}

window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && activeOverlay) {
                closeOverlay(activeOverlay);
        }
});

function initialise() {
        scheduleScan(true);
        observeDomChanges();
        patchHistoryMethods();
}

if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialise);
} else {
        initialise();
}

window.h5pQuizManager = Object.freeze({
        refresh: () => scheduleScan(true),
        config: configState.items.map(({ id, title, embedUrl }) => ({ id, title, embedUrl }))
});
