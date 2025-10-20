// script.js
// This file powers the Article to Tweets interface. It handles
// splitting the input text into 280‑character segments, then
// rendering each segment as a faux tweet using the same colour
// palette and typography as the provided portfolio example. The
// icons used in the tweet actions are pulled from the open
// source Heroicons project and inlined to avoid external
// dependencies.

/**
 * Split a block of text into tweet‑sized chunks. We favour
 * splitting on sentence boundaries where possible, so that tweets
 * read naturally. If a single sentence exceeds the tweet limit,
 * it will be broken on word boundaries instead.
 *
 * @param {string} text
 * @returns {string[]} An array of tweet segments
 */
function splitArticleIntoTweets(text) {
  // Normalise whitespace: collapse newlines and multiple spaces
  const normalised = text.replace(/\s+/g, ' ').trim();
  if (!normalised) return [];
  // Attempt to split into sentences using basic punctuation. This
  // regex matches a sequence of characters ending in . ! ? or the
  // end of string.
  const sentenceRegex = /[^.!?]+[.!?]+|[^.!?]+$/g;
  const sentences = normalised.match(sentenceRegex) || [normalised];
  const tweets = [];
  let current = '';
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    // If adding this sentence keeps us under the limit, append it.
    if ((current.length + trimmed.length + (current ? 1 : 0)) <= 280) {
      current += (current ? ' ' : '') + trimmed;
    } else {
      // Current tweet is full, push it and start a new one
      if (current) {
        tweets.push(current);
        current = '';
      }
      // If the sentence alone is larger than the limit, split by words
      if (trimmed.length > 280) {
        const words = trimmed.split(' ');
        let part = '';
        for (const word of words) {
          if ((part.length + word.length + (part ? 1 : 0)) <= 280) {
            part += (part ? ' ' : '') + word;
          } else {
            tweets.push(part);
            part = word;
          }
        }
        current = part;
      } else {
        current = trimmed;
      }
    }
  }
  if (current) tweets.push(current);
  return tweets;
}

/**
 * Split a block of text according to the selected mode. For
 * 'sentence', use Intl.Segmenter if available; otherwise fall
 * back to a regex that avoids splitting on common abbreviations.
 * For 'paragraph', split on blank lines. For '280', re-use
 * splitArticleIntoTweets().
 *
 * @param {string} text
 * @param {string} mode 'sentence' | 'paragraph' | '280'
 * @returns {string[]}
 */
function chunkArticle(text, mode) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (mode === 'sentence') {
    // Use Intl.Segmenter when available. It properly handles
    // locale-specific sentence boundaries.
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
        const segments = [];
        for (const { segment } of segmenter.segment(trimmed)) {
          segments.push(segment.trim());
        }
        return segments;
      } catch (err) {
        // Fallback to regex below
      }
    }
    // Fallback regex: split on punctuation followed by space/capital but
    // avoid common abbreviations like Mr., Mrs., Dr., i.e., etc.
    const abbrev = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|i\.e|e\.g|al)\.$/i;
    const parts = [];
    let lastIndex = 0;
    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (char === '.' || char === '!' || char === '?') {
        const snippet = trimmed.slice(lastIndex, i + 1).trim();
        // Look back to see if this period belongs to an abbreviation
        const words = snippet.split(/\s+/);
        const lastWord = words[words.length - 1];
        if (!abbrev.test(lastWord)) {
          parts.push(snippet);
          lastIndex = i + 1;
        }
      }
    }
    if (lastIndex < trimmed.length) {
      parts.push(trimmed.slice(lastIndex).trim());
    }
    return parts;
  }
  if (mode === 'paragraph') {
    // Split on two or more newlines (blank line). Retain single newlines
    // within paragraphs. Trim leading/trailing whitespace.
    return trimmed.split(/\n\s*\n+/).map((p) => p.trim());
  }
  // Default: 280-char greedy splitting
  return splitArticleIntoTweets(trimmed);
}

// ---------- UI enhancements ----------
// Accent colour used across the application. This central definition
// ensures that the burst animation uses the same hue as the hover and
// liked states. Keeping the colour in one place makes future tweaks
// straightforward.
const ACCENT_COLOUR = '#94c9a9';

// Global SVG icon definitions. Some UI components outside of the
// createTweetElement() function need access to these icons (e.g.
// the pencil icon for renaming folders). Define them once here so
// they are available in all scopes. Each string contains an
// inline SVG with dimensions and stroke attributes matching the
// other icons used throughout the interface. The stroke colour is
// inherited via CSS to allow easy tinting via currentColor.
const ICONS = {
  edit: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.586 3.586a2 2 0 012.828 0l2.414 2.414a2 2 0 010 2.828l-9.192 9.192a2 2 0 01-.707.414l-4.707 1.571a1 1 0 01-1.265-1.265l1.571-4.707a2 2 0 01.414-.707l9.192-9.192zM2 15.414l-.707.707L7.172 22H12v-4.828l-5.828-5.828L2 15.414z" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  ,
  // Copy icon used on each tweet card to copy its contents. The
  // colour inherits from currentColor so it matches the theme.
  copy: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 4H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-7l-6-6z" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 4v6h6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
};

// ----- New global state for extended functionality -----

// Current chunking mode: 'sentence', 'paragraph' or '280'. Defaults to '280'.
let currentMode = '280';

// Set of currently selected tweet elements (for bulk actions). We store DOM
// elements rather than texts to facilitate toggling state and retrieving
// metadata from data attributes.
const selectedTweets = new Set();

// Focus mode flag and index pointer. When focus mode is active, the
// normal list of tweets is hidden and a single card is displayed.
let focusModeActive = false;
let focusIndex = 0;

// Debounce timer for text input updates (stats bar). We use this to
// throttle expensive computations like word count when the user is
// typing rapidly.
let statsDebounceTimer = null;

// Last removed tweet entry for undo functionality. When a user deletes a
// saved tweet via drag left, we keep a reference here so it can be
// restored if the user clicks Undo within a short time.
let lastRemovedEntry = null;

// Number of snippets generated during the last chunking. This is used
// to display progress information in the stats bar after the user
// generates snippets. It is updated in renderTweets().
let lastSnippetCount = 0;

// A hidden aria-live region for announcing copy actions. Accessibility
// requires that we inform screen readers when something is copied.
let ariaLiveRegion = null;

/**
 * Animate a small burst around a liked heart. When a user hearts
 * a tweet, Twitter shows a little explosion of dots around the
 * heart. To emulate this, we dynamically create a handful of small
 * circles around the clicked element, animate them outward while
 * fading them out, then remove them. The animation is done via
 * CSS transitions so it's smooth and requires no external assets.
 *
 * @param {HTMLElement} span The span element containing the heart icon
 */
function animateHeartBurst(span) {
  // Define offset positions for the burst dots relative to the centre
  // Radiate eight dots outward. Distances are tuned so the burst is
  // noticeable without being distracting. Increasing these values will
  // enlarge the explosion; decreasing them will make it subtler.
  const offsets = [
    { x: 0, y: -18 },
    { x: 14, y: -12 },
    { x: 22, y: 0 },
    { x: 14, y: 12 },
    { x: 0, y: 18 },
    { x: -14, y: 12 },
    { x: -22, y: 0 },
    { x: -14, y: -12 },
  ];
  offsets.forEach((off) => {
    const dot = document.createElement('span');
    dot.classList.add('burst-dot');
    dot.style.backgroundColor = ACCENT_COLOUR;
    dot.style.position = 'absolute';
    dot.style.width = '8px';
    dot.style.height = '8px';
    dot.style.borderRadius = '50%';
    dot.style.top = '50%';
    dot.style.left = '50%';
    dot.style.transform = 'translate(-50%, -50%) scale(0)';
    dot.style.opacity = '1';
    dot.style.transition = 'transform 0.6s ease-out, opacity 0.6s ease-out';
    span.appendChild(dot);
    // Kick off the animation in the next frame so the transition applies
    requestAnimationFrame(() => {
      dot.style.transform = `translate(${off.x}px, ${off.y}px) scale(1)`;
      dot.style.opacity = '0';
    });
    // Remove the dot after the animation completes
    setTimeout(() => {
      dot.remove();
    }, 600);
  });
}

// ---------- Like persistence helpers ----------
// Fallback in-memory store if persistent storage isn't available
let likedTweetsMemory = [];

/**
 * Retrieve the array of liked tweet texts from storage. We first attempt
 * localStorage, then sessionStorage, then fall back to an in‑memory
 * array. This ensures likes work even when persistent storage is
 * unavailable (e.g. file:// origin).
 * @returns {string[]}
 */
function getLikedTweets() {
  // Attempt localStorage
  try {
    const stored = localStorage.getItem('likedTweets');
    if (stored) return JSON.parse(stored);
  } catch (err) {
    // ignore
  }
  // Attempt sessionStorage
  try {
    const storedSess = sessionStorage.getItem('likedTweets');
    if (storedSess) return JSON.parse(storedSess);
  } catch (err) {
    // ignore
  }
  // Fallback to memory
  return likedTweetsMemory;
}

/**
 * Save the provided array of tweets to storage. We try localStorage,
 * then sessionStorage. If both fail, we update the in‑memory store.
 * @param {string[]} tweets
 */
function setLikedTweets(tweets) {
  let stored = false;
  try {
    localStorage.setItem('likedTweets', JSON.stringify(tweets));
    stored = true;
  } catch (err) {
    // localStorage unavailable
  }
  if (!stored) {
    try {
      sessionStorage.setItem('likedTweets', JSON.stringify(tweets));
      stored = true;
    } catch (err) {
      // sessionStorage also unavailable
    }
  }
  if (!stored) {
    likedTweetsMemory = tweets;
  }
}

/**
 * Check whether a tweet text has already been liked.
 * @param {string} text
 * @returns {boolean}
 */
function isTweetLiked(text) {
  const liked = getLikedTweets();
  return liked.some((entry) => {
    if (typeof entry === 'string') {
      return entry === text;
    }
    return entry.text === text;
  });
}

/**
 * Add a tweet to the liked list and persist it.
 * @param {string} text
 */
/**
 * Add a tweet to the liked list and persist it. Accepts the tweet
 * content and optionally the article name and author handle. If an
 * entry with the same text already exists, nothing is added.
 *
 * @param {string} text
 * @param {string} name
 * @param {string} handle
 */
function likeTweet(text, name, handle, url = '', mode = currentMode) {
  const liked = getLikedTweets();
  const exists = liked.some((entry) => {
    return typeof entry === 'string' ? entry === text : entry.text === text;
  });
  if (!exists) {
    // Store as an object with metadata: include source URL and mode
    liked.push({ text, name, handle, url, mode });
    setLikedTweets(liked);
  }
}

/**
 * Remove a tweet from the liked list and persist it.
 * @param {string} text
 */
function unlikeTweet(text) {
  let liked = getLikedTweets();
  liked = liked.filter((entry) => {
    if (typeof entry === 'string') {
      return entry !== text;
    }
    return entry.text !== text;
  });
  setLikedTweets(liked);
}

/**
 * Render the saved tweets section based on current liked tweets.
 */
function renderSavedTweets() {
  const container = document.getElementById('savedTweets');
  if (!container) return;
  container.innerHTML = '';
  const liked = getLikedTweets();
  if (liked.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.textContent = 'No saved tweets yet.';
    emptyMsg.style.color = '#6c6c6c';
    emptyMsg.style.fontSize = '0.9rem';
    container.appendChild(emptyMsg);
    return;
  }
  liked.forEach((entry) => {
    const wrapper = document.createElement('div');
    wrapper.classList.add('saved-tweet');
    // Make the saved tweet draggable so users can drag it onto folder icons
    wrapper.setAttribute('draggable', 'true');
    // If the entry is a plain string (legacy), just display the text
    if (typeof entry === 'string') {
      wrapper.textContent = entry;
    } else {
      const header = document.createElement('div');
      header.classList.add('saved-tweet-header');
      // Format as "Article name by @username" for clarity
      if (entry.name && entry.handle) {
        header.textContent = `${entry.name} by ${entry.handle}`;
      } else {
      // Display article name and author handle separated by "by" for clarity
      const articleName = entry.name || '';
      const authorHandle = entry.handle || '';
      header.textContent = `${articleName} by ${authorHandle}`.trim();
      }
      const body = document.createElement('div');
      body.classList.add('saved-tweet-content');
      body.textContent = entry.text;
      wrapper.appendChild(header);
      wrapper.appendChild(body);
    }
    // Add swipe-to-unsave gesture. Users can click and drag left on a
    // saved tweet to remove it. If dragged beyond a threshold, the
    // tweet will flip and be removed from storage.
    let startX = null;
    let dragging = false;
    wrapper.addEventListener('mousedown', (evt) => {
      startX = evt.clientX;
      dragging = true;
      // Remove transition while dragging for immediate response
      wrapper.style.transition = 'none';
    });
    wrapper.addEventListener('mousemove', (evt) => {
      if (!dragging) return;
      const deltaX = evt.clientX - startX;
      if (deltaX < 0) {
        wrapper.style.transform = `translateX(${deltaX}px)`;
        // Add a visual delete overlay when dragged beyond a small threshold
        if (deltaX < -40) {
          wrapper.classList.add('deleting');
        } else {
          wrapper.classList.remove('deleting');
        }
      }
    });
    const endDrag = (evt) => {
      if (!dragging) return;
      dragging = false;
      wrapper.style.transition = 'transform 0.3s ease-out';
      const deltaX = (evt.clientX || startX) - startX;
      if (deltaX < -80) {
        // Swipe detected: play a smooth swipe animation then remove.
        // Remember the removed entry for undo.
        wrapper.classList.add('swipe-left');
        const removed = typeof entry === 'string'
          ? { text: entry, name: '', handle: '', url: '', mode: currentMode }
          : entry;
        lastRemovedEntry = { entry: removed };
        // After animation, remove from storage and update UI. Shorten
        // timeout to match the animation duration defined in CSS.
        setTimeout(() => {
          const text = removed.text;
          unlikeTweet(text);
          renderSavedTweets();
          // Show undo toast
          showUndoToast();
        }, 500);
      } else {
        // Not enough swipe: reset
        wrapper.style.transform = 'translateX(0)';
        wrapper.classList.remove('deleting');
      }
      startX = null;
    };
    wrapper.addEventListener('mouseup', endDrag);
    wrapper.addEventListener('mouseleave', endDrag);
    // Drag and drop: when dragging starts, remember the entry
    wrapper.addEventListener('dragstart', (evt) => {
      draggedEntry = typeof entry === 'string' ? { text: entry, name: '', handle: '' } : entry;
      // Provide some opacity to indicate dragging
      wrapper.style.opacity = '0.5';
    });
    wrapper.addEventListener('dragend', () => {
      // Reset opacity and clear global
      wrapper.style.opacity = '';
      draggedEntry = null;
    });
    container.appendChild(wrapper);
  });
}

// ---------- Share helpers ----------
/**
 * Remove all active share menus from the DOM.
 */
function clearShareMenus() {
  document.querySelectorAll('.share-menu').forEach((menu) => menu.remove());
}

// Currently dragged entry used for drag‑and‑drop between saved tweets and
// folder icons. We use a simple global rather than DataTransfer as
// storing complex objects in DataTransfer can be unreliable across
// browsers and our environment.
let draggedEntry = null;

// ---------- Folder management helpers ----------
// Fallback in-memory store if persistent storage isn't available.  There are two
// folder concepts in this app:
//
// 1. A simple list of folder names displayed under the “Saved Tweets” heading.
//    These are created via the plus button next to the Saved Tweets header and
//    stored in the `savedFolders` key. Each entry is an object with a
//    `name` string. Tweets are not stored here.
//
// 2. A map of folder names to arrays of tweet entries used by the per‑tweet
//    “plus” icon. This structure is stored in the `tweetFolders` key.
//
// This separation avoids collisions between the two storage purposes. See
// getSavedFolderList()/setSavedFolderList() for the simple list and
// getTweetFolders()/setTweetFolders() for the tweet folders.
let savedFoldersMemory = [];

/**
 * Retrieve the array of saved folders from storage. Each folder is an
 * object with a `name` property and an optional `tweets` array for
 * future use. Returns an empty array if none exist.
 * @returns {Array<{name: string, tweets?: any[]}>}
 */
/**
 * Retrieve the array of folder objects currently stored under the
 * `savedFolders` key. Each entry has a `name` property only. This helper
 * uses a fallback memory store when localStorage/sessionStorage are
 * unavailable. These folders are only for display under the Saved Tweets
 * heading and do not contain tweet data.
 *
 * @returns {Array<{name: string}>}
 */
function getSavedFolderList() {
  try {
    const stored = localStorage.getItem('savedFolders');
    if (stored) return JSON.parse(stored);
  } catch (err) {
    // ignore
  }
  try {
    const storedSess = sessionStorage.getItem('savedFolders');
    if (storedSess) return JSON.parse(storedSess);
  } catch (err) {
    // ignore
  }
  return savedFoldersMemory;
}

/**
 * Persist the provided array of simple folder objects. These are stored
 * under the `savedFolders` key and hold only a `name` property. We
 * attempt to write to localStorage first, then sessionStorage, then
 * update the in‑memory fallback.
 *
 * @param {Array<{name: string}>} folders
 */
function setSavedFolderList(folders) {
  let stored = false;
  try {
    localStorage.setItem('savedFolders', JSON.stringify(folders));
    stored = true;
  } catch (err) {
    // ignore
  }
  if (!stored) {
    try {
      sessionStorage.setItem('savedFolders', JSON.stringify(folders));
      stored = true;
    } catch (err) {
      // ignore
    }
  }
  if (!stored) {
    savedFoldersMemory = folders;
  }
}

/**
 * Create a new folder with the given name if it doesn't already exist.
 * Names are treated case‑insensitively when checking for duplicates.
 * After adding, re-render the folders UI.
 * @param {string} name
 */
function addFolder(name) {
  // This function adds to the simple folder list used by the Saved Tweets
  // section header. It does not manage tweet storage. See addToFolder() for
  // adding tweets to folders.
  const folders = getSavedFolderList();
  const exists = folders.some((f) => f.name.toLowerCase() === name.toLowerCase());
  if (exists) return;
  folders.push({ name });
  setSavedFolderList(folders);
  renderFolders();
}

/**
 * Render the list of folders below the saved tweets section. Each folder
 * is shown as a simple box with its name. For now, folders do not
 * contain tweets; this is reserved for future expansion.
 */
function renderFolders() {
  const container = document.getElementById('foldersContainer');
  if (!container) return;
  container.innerHTML = '';
  const folders = getSavedFolderList();
  folders.forEach((folder) => {
    const div = document.createElement('div');
    div.classList.add('folder');
    div.textContent = folder.name;
    container.appendChild(div);
  });
}

/**
 * Render floating folder icons on the right side of the screen. Each folder
 * icon corresponds to a key in the tweetFolders object. Icons are
 * clickable to open the folder view, and can receive drops of saved
 * tweets to add them to the folder. Newly created icons receive an
 * `icon-burst` class to animate their entrance. This function
 * clears and repopulates the container on each call.
 */
function renderFolderIcons() {
  const container = document.getElementById('folderIcons');
  if (!container) return;
  container.innerHTML = '';
  const folders = getTweetFolders();
  // Ensure the order array includes all existing folders (legacy ones)
  let order = getFolderOrder();
  const existing = Object.keys(folders);
  // Add any folders missing from order
  existing.forEach((fname) => {
    if (!order.includes(fname)) order.push(fname);
  });
  // Remove names no longer present in folders
  order = order.filter((fname) => existing.includes(fname));
  setFolderOrder(order);
  order.forEach((fname) => {
    // Wrapper holds the pictogram and the label.  Clicks and drops
    // apply to the whole wrapper so the user can click the text or
    // the icon.
    const wrapper = document.createElement('div');
    wrapper.classList.add('folder-icon-wrapper');
    wrapper.dataset.folderName = fname;
    // Pictogram
    const icon = document.createElement('div');
    icon.classList.add('folder-icon');
    wrapper.appendChild(icon);
    // Label underneath
    const label = document.createElement('div');
    label.classList.add('folder-name');
    label.textContent = fname;
    wrapper.appendChild(label);
    // Clicking opens folder view
    wrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      showFolderView(fname);
    });
    // Drag over handler to allow dropping saved tweets.  Highlight
    // the icon on drag over.
    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      icon.style.transform = 'scale(1.1)';
    });
    wrapper.addEventListener('dragleave', () => {
      icon.style.transform = '';
    });
    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      icon.style.transform = '';
      if (draggedEntry) {
        addToFolder(fname, draggedEntry);
        // Provide burst feedback on the pictogram
        wrapper.classList.add('icon-burst');
        setTimeout(() => {
          wrapper.classList.remove('icon-burst');
        }, 500);
        draggedEntry = null;
      }
    });
    container.appendChild(wrapper);
  });
}

/**
 * Apply a burst animation to the folder icon matching the given name. This
 * gives a visual cue when a folder is newly created or when a tweet
 * has been added to an existing folder. If the folder icon is not
 * found, nothing happens.
 *
 * @param {string} folderName
 */
function burstFolderIcon(folderName) {
  const container = document.getElementById('folderIcons');
  if (!container) return;
  // Look for the folder wrapper with matching data attribute
  const wrappers = container.querySelectorAll('.folder-icon-wrapper');
  wrappers.forEach((wrapper) => {
    if (wrapper.dataset.folderName === folderName) {
      wrapper.classList.add('icon-burst');
      setTimeout(() => {
        wrapper.classList.remove('icon-burst');
      }, 500);
    }
  });
}

/**
 * Display the contents of a folder in the folder view. Hides the
 * normal saved tweets list and shows the tweets belonging to the
 * specified folder. Each entry is rendered similarly to the saved
 * tweets section. A back button allows returning to the default
 * saved tweets view.
 *
 * @param {string} folderName
 */
function showFolderView(folderName) {
  const folderView = document.getElementById('folderView');
  const savedSection = document.getElementById('savedTweets');
  if (!folderView || !savedSection) return;
  const folders = getTweetFolders();
  const entries = folders[folderName] || [];
  // Clear existing content
  folderView.innerHTML = '';
  // Build header with back button and folder name
  const header = document.createElement('div');
  header.classList.add('folder-view-header');
  const backBtn = document.createElement('button');
  // Use an inline SVG arrow for the back button.  The stroke
  // colour will be set below to match the accent hue.  Remove
  // any default button styling.
  backBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 15L3 9M3 9L9 3M3 9H15C18.3137 9 21 11.6863 21 15C21 18.3137 18.3137 21 15 21H12" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  backBtn.style.background = 'none';
  backBtn.style.border = 'none';
  backBtn.style.padding = '0';
  backBtn.style.cursor = 'pointer';
  // Set the icon colour to the accent colour
  const backSvg = backBtn.querySelector('svg');
  if (backSvg) {
    backSvg.style.stroke = ACCENT_COLOUR;
  }
  backBtn.addEventListener('click', () => {
    hideFolderView();
  });
  const title = document.createElement('h3');
  title.textContent = folderName;
  header.appendChild(backBtn);
  header.appendChild(title);
  // Add a pencil icon for renaming the folder.  Clicking toggles
  // between edit mode and save mode.  When in edit mode the title
  // becomes contenteditable and the caret appears at the end.  When
  // clicked again the new name is persisted (if non-empty) and the
  // folder is renamed across storage.  A burst animation indicates
  // success.
  const editBtn = document.createElement('button');
  // Use the globally defined edit icon. The stroke colour inherits from CSS.
  editBtn.innerHTML = ICONS.edit;
  editBtn.style.background = 'none';
  editBtn.style.border = 'none';
  editBtn.style.padding = '0';
  editBtn.style.cursor = 'pointer';
  // Colour the stroke to accent colour
  const editSvg = editBtn.querySelector('svg');
  if (editSvg) {
    editSvg.style.stroke = ACCENT_COLOUR;
  }
  // Track editing state on the button
  editBtn.dataset.editing = 'false';
  editBtn.addEventListener('click', () => {
    const isEditing = editBtn.dataset.editing === 'true';
    if (!isEditing) {
      // Enter edit mode
      editBtn.dataset.editing = 'true';
      // Make title editable and focus
      title.setAttribute('contenteditable', 'true');
      title.spellcheck = false;
      title.focus();
      // Move caret to end
      const range = document.createRange();
      range.selectNodeContents(title);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      // Exit edit mode and save
      editBtn.dataset.editing = 'false';
      title.removeAttribute('contenteditable');
      const newName = title.textContent.trim();
      // Restore original name if empty
      if (newName && newName !== folderName) {
        /*
         * Persist the rename without altering the folder ordering.  We need
         * to determine whether the destination folder existed *before* the
         * rename, then update the folder order accordingly.  The goal is
         * that renaming a folder does not change its relative position
         * in the right-hand folder list.  If the target name existed
         * previously, we merge the contents and simply drop the old name
         * from the order.  If the target is new, we replace the old
         * name at its current index.  This logic avoids always pushing
         * the renamed folder to the end.
         */
        // Capture the set of folders before applying any rename changes.
        const beforeFolders = getTweetFolders();
        const foldersMap = getTweetFolders();
        // Grab and remove the entries for the old folder
        const entriesForOld = foldersMap[folderName] || [];
        // Check if the destination folder name existed previously
        const preExisting = Object.prototype.hasOwnProperty.call(beforeFolders, newName);
        if (preExisting) {
          // Merge unique entries into the existing folder
          entriesForOld.forEach((ent) => {
            const exists = foldersMap[newName].some((e) => e.text === ent.text);
            if (!exists) foldersMap[newName].push(ent);
          });
          delete foldersMap[folderName];
        } else {
          // Create a new folder with the old entries and remove the old name
          foldersMap[newName] = entriesForOld;
          delete foldersMap[folderName];
        }
        setTweetFolders(foldersMap);
        // Compute the current order of folders as shown in the UI.  We read
        // from the DOM (#folderIcons) because the order stored in
        // localStorage may be empty or outdated.  This ensures that
        // when we rename a folder we preserve its visual position.
        let currentOrder = [];
        const iconContainer = document.getElementById('folderIcons');
        if (iconContainer) {
          currentOrder = Array.from(iconContainer.querySelectorAll('.folder-icon-wrapper')).map((el) => el.dataset.folderName);
        }
        // If we couldn't read from the DOM, fall back to stored order
        if (currentOrder.length === 0) {
          currentOrder = getFolderOrder();
        }
        // Remove the old name from the order list
        const index = currentOrder.indexOf(folderName);
        if (index !== -1) {
          currentOrder.splice(index, 1);
        }
        if (!preExisting) {
          // Insert the new name at the same index (or at end if not found)
          const insertAt = index >= 0 ? index : currentOrder.length;
          currentOrder.splice(insertAt, 0, newName);
        }
        // Persist the updated order
        setFolderOrder(currentOrder);
        // Instead of fully re-rendering all folder icons (which could
        // inadvertently reorder them based on object key order), we
        // directly update the DOM element representing the renamed
        // folder.  This ensures that the visual position of the folder
        // remains unchanged.  We locate the wrapper by its data
        // attribute, update its dataset and the visible label, and
        // perform a burst animation for feedback.  If the wrapper
        // cannot be found, we fall back to re-rendering icons.
        const iconContainer2 = document.getElementById('folderIcons');
        let updated = false;
        if (iconContainer2) {
          const wrappers = iconContainer2.querySelectorAll('.folder-icon-wrapper');
          wrappers.forEach((wrapper) => {
            if (wrapper.dataset.folderName === folderName) {
              wrapper.dataset.folderName = newName;
              const labelEl = wrapper.querySelector('.folder-name');
              if (labelEl) labelEl.textContent = newName;
              // Provide burst animation to indicate successful rename
              wrapper.classList.add('icon-burst');
              setTimeout(() => {
                wrapper.classList.remove('icon-burst');
              }, 500);
              updated = true;
            }
          });
        }
        if (!updated) {
          // If we didn't find the wrapper, re-render as a fallback
          renderFolderIcons();
        }
        animateHeartBurst(editBtn);
        showFolderView(newName);
        return;
      }
      // If no change, simply stop editing and reset caret
      showFolderView(folderName);
    }
  });
  header.appendChild(editBtn);
  folderView.appendChild(header);
  if (entries.length === 0) {
    const msg = document.createElement('p');
    msg.textContent = 'No tweets in this folder yet.';
    msg.style.color = '#6c6c6c';
    msg.style.fontSize = '0.9rem';
    folderView.appendChild(msg);
  } else {
    entries.forEach((entry) => {
      const wrapper = document.createElement('div');
      wrapper.classList.add('saved-tweet');
      // Render header: article name by author
      const headerEl = document.createElement('div');
      headerEl.classList.add('saved-tweet-header');
      headerEl.textContent = `${entry.name || ''} by ${entry.handle || ''}`.trim();
      const bodyEl = document.createElement('div');
      bodyEl.classList.add('saved-tweet-content');
      bodyEl.textContent = entry.text;
      wrapper.appendChild(headerEl);
      wrapper.appendChild(bodyEl);
      // Allow unsaving from folder view via swipe left (like saved section)
      let startX = null;
      let dragging = false;
      wrapper.addEventListener('mousedown', (evt) => {
        startX = evt.clientX;
        dragging = true;
        wrapper.style.transition = 'none';
      });
      wrapper.addEventListener('mousemove', (evt) => {
        if (!dragging) return;
        const deltaX = evt.clientX - startX;
        if (deltaX < 0) {
          wrapper.style.transform = `translateX(${deltaX}px)`;
          if (deltaX < -40) {
            wrapper.classList.add('deleting');
          } else {
            wrapper.classList.remove('deleting');
          }
        }
      });
      const endDrag = (evt) => {
        if (!dragging) return;
        dragging = false;
        wrapper.style.transition = 'transform 0.3s ease-out';
        const deltaX = (evt.clientX || startX) - startX;
        if (deltaX < -80) {
          wrapper.classList.add('swipe-left');
          // Capture removed entry and folder for undo
          lastRemovedEntry = { entry, folder: folderName };
          setTimeout(() => {
            const foldersMap = getTweetFolders();
            foldersMap[folderName] = foldersMap[folderName].filter(
              (item) => item.text !== entry.text
            );
            setTweetFolders(foldersMap);
            showFolderView(folderName);
            renderFolderIcons();
            showUndoToast();
          }, 500);
        } else {
          wrapper.style.transform = 'translateX(0)';
          wrapper.classList.remove('deleting');
        }
        startX = null;
      };
      wrapper.addEventListener('mouseup', endDrag);
      wrapper.addEventListener('mouseleave', endDrag);
      folderView.appendChild(wrapper);
    });
  }
  // Hide saved tweets and show folder view
  savedSection.style.display = 'none';
  folderView.style.display = 'block';
}

/**
 * Hide the folder view and return to the normal saved tweets display.
 */
function hideFolderView() {
  const folderView = document.getElementById('folderView');
  const savedSection = document.getElementById('savedTweets');
  if (folderView && savedSection) {
    folderView.style.display = 'none';
    savedSection.style.display = 'block';
  }
}

/**
 * Display an undo toast after a snippet is removed via swipe. The toast
 * appears fixed at the bottom-right of the viewport and offers
 * an Undo button. If clicked, the removed entry is restored to its
 * previous location (either the liked list or a specific folder).
 * The toast auto-dismisses after four seconds if no action is taken.
 */
function showUndoToast() {
  // Remove any existing toast
  document.querySelectorAll('.undo-toast').forEach((t) => t.remove());
  if (!lastRemovedEntry || !lastRemovedEntry.entry) return;
  const toast = document.createElement('div');
  toast.classList.add('undo-toast');
  const msg = document.createElement('span');
  // Use "Note removed" instead of "Snippet removed" to better
  // reflect the article-centric terminology. This small change
  // improves clarity for the user when they remove a saved card.
  msg.textContent = 'Note removed.';
  toast.appendChild(msg);
  const undoBtn = document.createElement('button');
  undoBtn.classList.add('undo-btn');
  undoBtn.textContent = 'Undo';
  undoBtn.addEventListener('click', () => {
    // Restore the removed entry
    const { entry, folder } = lastRemovedEntry;
    if (folder) {
      const folders = getTweetFolders();
      if (!folders[folder]) folders[folder] = [];
      // Avoid duplicates
      if (!folders[folder].some((it) => it.text === entry.text)) {
        folders[folder].push(entry);
        setTweetFolders(folders);
      }
      showFolderView(folder);
      renderFolderIcons();
    } else {
      likeTweet(entry.text, entry.name, entry.handle, entry.url, entry.mode);
      renderSavedTweets();
    }
    lastRemovedEntry = null;
    toast.remove();
  });
  toast.appendChild(undoBtn);
  document.body.appendChild(toast);
  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
    lastRemovedEntry = null;
  }, 4000);
}

/**
 * Create and display a share menu positioned relative to the mouse pointer. The menu
 * appears slightly to the right of the pointer so it doesn't obscure the icon. It
 * remains visible while the pointer is over the icon or the menu itself, and
 * disappears when the pointer leaves both.
 *
 * @param {MouseEvent} event The triggering mouse event (from click or hover)
 * @param {string} text The content of the tweet being shared
 */
let shareHideTimer;
function showShareMenu(event, text) {
  // Clear any existing share or plus menus so only one menu is visible
  clearShareMenus();
  clearPlusMenus();
  const menu = document.createElement('div');
  menu.classList.add('share-menu');
  const encoded = encodeURIComponent(text);
  // Twitter intent link
  const twitterLink = document.createElement('a');
  twitterLink.href = `https://twitter.com/intent/tweet?text=${encoded}`;
  twitterLink.target = '_blank';
  twitterLink.rel = 'noopener noreferrer';
  twitterLink.textContent = 'Share on X';
  twitterLink.addEventListener('click', (e) => {
    e.preventDefault();
    try {
      window.open(`https://twitter.com/intent/tweet?text=${encoded}`, '_blank');
    } catch (err) {
      window.location.href = `https://twitter.com/intent/tweet?text=${encoded}`;
    }
    // Hide the menu after clicking a share option
    clearShareMenus();
  });
  // Email share link
  const emailLink = document.createElement('a');
  emailLink.href = `mailto:?subject=Interesting%20article%20snippet&body=${encoded}`;
  emailLink.textContent = 'Share via Email';
  emailLink.addEventListener('click', (e) => {
    e.preventDefault();
    try {
      window.open(`mailto:?subject=Interesting%20article%20snippet&body=${encoded}`, '_self');
    } catch (err) {
      window.location.href = `mailto:?subject=Interesting%20article%20snippet&body=${encoded}`;
    }
    // Hide the menu after clicking a share option
    clearShareMenus();
  });
  menu.appendChild(twitterLink);
  menu.appendChild(emailLink);
  // Position the menu relative to the mouse pointer. We use fixed positioning
  // so that scrolling doesn't move the menu. Set bottom and transform to
  // defaults to avoid conflicting CSS rules. Add a small offset so the menu
  // appears to the right of the pointer and slightly above it. This keeps
  // the menu from covering the icon directly under the cursor.
  const pointerX = event.clientX;
  const pointerY = event.clientY;
  const offsetX = 15; // pixels to the right of the pointer
  const offsetY = -10; // slightly above the pointer
  menu.style.position = 'fixed';
  menu.style.left = `${pointerX + offsetX}px`;
  menu.style.top = `${pointerY + offsetY}px`;
  // Ensure no residual bottom or transform styles interfere
  menu.style.bottom = 'auto';
  menu.style.transform = 'none';
  document.body.appendChild(menu);
  // Manage hover behaviour: clear hide timer when entering menu
  menu.addEventListener('mouseenter', () => {
    if (shareHideTimer) {
      clearTimeout(shareHideTimer);
      shareHideTimer = null;
    }
  });
  // Hide when leaving menu
  menu.addEventListener('mouseleave', () => {
    clearShareMenus();
  });
}

// ---------- Folder helpers for the plus menu ----------
// Hide any active plus menus
function clearPlusMenus() {
  document.querySelectorAll('.plus-menu').forEach((m) => m.remove());
}

// Retrieve folders from storage. Returns an object mapping folder
// names to arrays of tweet entries (objects with text, name, handle).
function getTweetFolders() {
  try {
    const stored = localStorage.getItem('tweetFolders');
    if (stored) return JSON.parse(stored);
  } catch (err) {
    // ignore
  }
  try {
    const storedSess = sessionStorage.getItem('tweetFolders');
    if (storedSess) return JSON.parse(storedSess);
  } catch (err) {
    // ignore
  }
  return {};
}

// Retrieve the stored order of folders. The order is an array of
// folder names preserving the sequence in which folders were created or
// renamed. If no order is stored, return an empty array. The order
// is stored in localStorage or sessionStorage similarly to folders.
function getFolderOrder() {
  try {
    const stored = localStorage.getItem('folderOrder');
    if (stored) return JSON.parse(stored);
  } catch (err) {
    // ignore
  }
  try {
    const storedSess = sessionStorage.getItem('folderOrder');
    if (storedSess) return JSON.parse(storedSess);
  } catch (err) {
    // ignore
  }
  return [];
}

// Persist the folder order to storage. Accepts an array of folder
// names. This ensures folder icons remain in consistent positions
// even after renaming.
function setFolderOrder(order) {
  let stored = false;
  try {
    localStorage.setItem('folderOrder', JSON.stringify(order));
    stored = true;
  } catch (err) {
    // ignore
  }
  if (!stored) {
    try {
      sessionStorage.setItem('folderOrder', JSON.stringify(order));
      stored = true;
    } catch (err) {
      // ignore
    }
  }
}

// Persist folders to storage. Accepts an object mapping folder names to
// arrays of tweet entries.
function setTweetFolders(folders) {
  let stored = false;
  try {
    localStorage.setItem('tweetFolders', JSON.stringify(folders));
    stored = true;
  } catch (err) {
    // ignore
  }
  if (!stored) {
    try {
      sessionStorage.setItem('tweetFolders', JSON.stringify(folders));
      stored = true;
    } catch (err) {
      // ignore
    }
  }
}

// Add a tweet entry to a named folder. If the folder does not exist,
// it will be created. Duplicate entries (same text) are not added twice.
function addToFolder(folderName, entry) {
  const folders = getTweetFolders();
  if (!folders[folderName]) {
    // New folder: initialise array and record its order
    folders[folderName] = [];
    // Update folder order if this is a new folder
    const order = getFolderOrder();
    if (!order.includes(folderName)) {
      order.push(folderName);
      setFolderOrder(order);
    }
  }
  const exists = folders[folderName].some((item) => item.text === entry.text);
  if (!exists) {
    folders[folderName].push(entry);
    setTweetFolders(folders);
  }
}

/**
 * Display a menu for creating or selecting folders for a tweet. The menu
 * appears near the mouse pointer. Users can enter a new folder name
 * and click “Create” to add the tweet to that folder, or select an
 * existing folder name to add the tweet there. The menu disappears
 * when the pointer leaves it or the trigger icon.
 *
 * @param {MouseEvent} event
 * @param {{text:string,name:string,handle:string}} entry
 */
let plusHideTimer;
function showPlusMenu(event, entry) {
  // Clear any existing menus so the plus menu is the only one visible
  clearPlusMenus();
  clearShareMenus();
  const menu = document.createElement('div');
  menu.classList.add('plus-menu');
  // Input for new folder
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'New folder name';
  input.style.padding = '6px 8px';
  input.style.border = '1px solid #e7e4de';
  input.style.borderRadius = '6px';
  input.style.fontFamily = 'Charter, serif';
  input.style.fontSize = '0.85rem';
  // Create button
  const createBtn = document.createElement('button');
  createBtn.textContent = 'Create';
  createBtn.style.marginTop = '6px';
  createBtn.style.padding = '6px 8px';
  createBtn.style.fontFamily = 'Charter, serif';
  createBtn.style.fontSize = '0.85rem';
  createBtn.style.backgroundColor = '#94c9a9';
  createBtn.style.color = '#fff';
  createBtn.style.border = 'none';
  createBtn.style.borderRadius = '6px';
  createBtn.style.cursor = 'pointer';
  createBtn.addEventListener('click', () => {
    const folderName = input.value.trim();
    if (folderName) {
      // Before adding, check if folder already exists
      const beforeFolders = Object.keys(getTweetFolders());
      addToFolder(folderName, entry);
      clearPlusMenus();
      // If folder is new, re-render icons and animate the new one
      const afterFolders = Object.keys(getTweetFolders());
      renderFolderIcons();
      // Determine if a new folder was added
      if (afterFolders.length > beforeFolders.length) {
        burstFolderIcon(folderName);
      }
    }
  });
  menu.appendChild(input);
  menu.appendChild(createBtn);
  // Divider
  const divider = document.createElement('hr');
  divider.style.margin = '8px 0';
  divider.style.border = 'none';
  divider.style.height = '1px';
  divider.style.backgroundColor = '#e7e4de';
  menu.appendChild(divider);
  // Existing folders list
  const folders = getTweetFolders();
  // Use the stored folder order to display folders consistently
  const names = getFolderOrder().filter((fname) => folders[fname]);
  if (names.length > 0) {
    names.forEach((fname) => {
      const item = document.createElement('a');
      item.textContent = fname;
      item.href = '#';
      item.style.display = 'block';
      item.style.padding = '4px 0';
      item.style.fontSize = '0.85rem';
      item.style.color = '#2f2c26';
      item.style.textDecoration = 'none';
      item.addEventListener('click', (e) => {
        e.preventDefault();
        addToFolder(fname, entry);
        clearPlusMenus();
        // Re-render icons in case the folder list has just been created
        renderFolderIcons();
        // Provide subtle burst on existing folder icon
        burstFolderIcon(fname);
      });
      item.addEventListener('mouseenter', () => {
        item.style.color = '#94c9a9';
      });
      item.addEventListener('mouseleave', () => {
        item.style.color = '#2f2c26';
      });
      menu.appendChild(item);
    });
  } else {
    const noFolder = document.createElement('div');
    noFolder.textContent = 'No folders yet.';
    noFolder.style.fontSize = '0.8rem';
    noFolder.style.color = '#6c6c6c';
    menu.appendChild(noFolder);
  }
  // Position the menu relative to the mouse pointer
  const pointerX = event.clientX;
  const pointerY = event.clientY;
  const offsetX = 15;
  const offsetY = -10;
  menu.style.position = 'fixed';
  menu.style.left = `${pointerX + offsetX}px`;
  menu.style.top = `${pointerY + offsetY}px`;
  menu.style.bottom = 'auto';
  menu.style.transform = 'none';
  document.body.appendChild(menu);
  // Hover behaviour: clear hide timer on enter
  menu.addEventListener('mouseenter', () => {
    if (plusHideTimer) {
      clearTimeout(plusHideTimer);
      plusHideTimer = null;
    }
  });
  // Hide when leaving menu
  menu.addEventListener('mouseleave', () => {
    clearPlusMenus();
  });
}

/**
 * Create and display a small export menu for a folder. The menu
 * appears just to the left of the folder icon wrapper when the
 * user hovers over it. Two options are provided: export as
 * Markdown or export as JSON. Export only the contents of the
 * hovered folder. Only one export menu is visible at a time.
 *
 * @param {MouseEvent} event
 * @param {string} folderName
 */
function showFolderExportMenu(event, folderName) {
  hideFolderExportMenu();
  const menu = document.createElement('div');
  menu.classList.add('folder-export-menu');
  // Create markdown export option
  const md = document.createElement('div');
  md.classList.add('export-item');
  md.textContent = 'Export as Markdown';
  md.addEventListener('click', (e) => {
    e.preventDefault();
    exportFolder(folderName, 'markdown');
    hideFolderExportMenu();
  });
  menu.appendChild(md);
  // JSON export option
  const js = document.createElement('div');
  js.classList.add('export-item');
  js.textContent = 'Export as JSON';
  js.addEventListener('click', (e) => {
    e.preventDefault();
    exportFolder(folderName, 'json');
    hideFolderExportMenu();
  });
  menu.appendChild(js);
  // Position the menu relative to the wrapper: to the left and aligned
  // vertically in the middle. Use the wrapper's bounding rect.
  const wrapper = event.currentTarget;
  const rect = wrapper.getBoundingClientRect();
  menu.style.position = 'fixed';
  const menuWidth = 140; // approximate width; CSS may override
  const top = rect.top + rect.height / 2 - 20; // centre vertically
  const left = rect.left - menuWidth - 8; // to the left with gap
  menu.style.top = `${Math.max(top, 10)}px`;
  menu.style.left = `${Math.max(left, 10)}px`;
  document.body.appendChild(menu);
  // Keep menu visible when hovering; hide on leave
  menu.addEventListener('mouseleave', () => {
    hideFolderExportMenu();
  });
}

/**
 * Remove any folder export menus currently displayed. This ensures
 * that only one folder export menu is visible at a time and
 * cleans up leftover menus when the pointer leaves the icon.
 */
function hideFolderExportMenu() {
  document.querySelectorAll('.folder-export-menu').forEach((m) => m.remove());
}

/**
 * Create and return a tweet DOM element from the provided text.
 *
 * @param {string} text The tweet content
 * @param {string} name The display name for the tweet header
 * @param {string} handle The handle (including @)
 * @returns {HTMLElement}
 */
function createTweetElement(text, name, handle, index, total) {
  const tweetEl = document.createElement('div');
  tweetEl.classList.add('tweet');

  // Header
  const headerEl = document.createElement('div');
  headerEl.classList.add('tweet-header');
  // Avatar: just the first letter of the name
  const avatarEl = document.createElement('div');
  avatarEl.classList.add('avatar');
  // Use the first letter of the author handle (without the @ sign) for the avatar
  const authorInitial = handle.replace(/^@/, '').trim().charAt(0) || name.charAt(0);
  avatarEl.textContent = authorInitial.toUpperCase();
  headerEl.appendChild(avatarEl);
  // Details (name, handle & date)
  const detailsEl = document.createElement('div');
  detailsEl.classList.add('tweet-details');
  const nameEl = document.createElement('span');
  nameEl.classList.add('name');
  nameEl.textContent = name;
  const handleEl = document.createElement('span');
  handleEl.classList.add('handle');
  // Format date as e.g. Aug 25
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  handleEl.textContent = `${handle} · ${dateStr}`;
  detailsEl.appendChild(nameEl);
  detailsEl.appendChild(handleEl);
  headerEl.appendChild(detailsEl);
  // Selection checkbox. This is hidden until hover but remains accessible.
  const selectContainer = document.createElement('div');
  selectContainer.classList.add('tweet-select');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.classList.add('tweet-select-checkbox');
  // When the checkbox state changes, update the selected set and toolbar
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      selectedTweets.add(tweetEl);
    } else {
      selectedTweets.delete(tweetEl);
    }
    updateBulkToolbar();
  });
  selectContainer.appendChild(checkbox);
  headerEl.appendChild(selectContainer);
  tweetEl.appendChild(headerEl);

  // Copy button. Appears on hover in the top-right corner of the card.
  const copyBtn = document.createElement('button');
  copyBtn.classList.add('copy-btn');
  copyBtn.setAttribute('aria-label', 'Copy snippet');
  copyBtn.innerHTML = ICONS.copy;
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyToClipboard(text);
  });
  tweetEl.appendChild(copyBtn);

  // Content
  const contentEl = document.createElement('p');
  contentEl.classList.add('tweet-content');
  contentEl.textContent = text;
  tweetEl.appendChild(contentEl);

  // Actions with icons. We'll inline open source SVG paths from Heroicons and
  // rely on currentColor for stroke. No external network is needed.
  const actionsEl = document.createElement('div');
  actionsEl.classList.add('tweet-actions');

  // Icons definitions. Each entry includes an SVG string. The stroke
  // attribute is omitted so the inherited CSS colour is applied.
  const icons = {
    reply: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 15L3 9M3 9L9 3M3 9H15C18.3137 9 21 11.6863 21 15C21 18.3137 18.3137 21 15 21H12" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    retweet: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16.0228 9.34841H21.0154V9.34663M2.98413 19.6444V14.6517M2.98413 14.6517L7.97677 14.6517M2.98413 14.6517L6.16502 17.8347C7.15555 18.8271 8.41261 19.58 9.86436 19.969C14.2654 21.1483 18.7892 18.5364 19.9685 14.1353M4.03073 9.86484C5.21 5.46374 9.73377 2.85194 14.1349 4.03121C15.5866 4.4202 16.8437 5.17312 17.8342 6.1655L21.0154 9.34663M21.0154 4.3558V9.34663" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    like: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 8.25C21 5.76472 18.9013 3.75 16.3125 3.75C14.3769 3.75 12.7153 4.87628 12 6.48342C11.2847 4.87628 9.62312 3.75 7.6875 3.75C5.09867 3.75 3 5.76472 3 8.25C3 15.4706 12 20.25 12 20.25C12 20.25 21 15.4706 21 8.25Z" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    likeFilled: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.645 20.9107L11.6384 20.9072L11.6158 20.8949C11.5965 20.8844 11.5689 20.8693 11.5336 20.8496C11.4629 20.8101 11.3612 20.7524 11.233 20.6769C10.9765 20.5261 10.6132 20.3039 10.1785 20.015C9.31074 19.4381 8.15122 18.5901 6.9886 17.5063C4.68781 15.3615 2.25 12.1751 2.25 8.25C2.25 5.32194 4.7136 3 7.6875 3C9.43638 3 11.0023 3.79909 12 5.0516C12.9977 3.79909 14.5636 3 16.3125 3C19.2864 3 21.75 5.32194 21.75 8.25C21.75 12.1751 19.3122 15.3615 17.0114 17.5063C15.8488 18.5901 14.6893 19.4381 13.8215 20.015C13.3868 20.3039 13.0235 20.5261 12.767 20.6769C12.6388 20.7524 12.5371 20.8101 12.4664 20.8496C12.4311 20.8693 12.4035 20.8844 12.3842 20.8949L12.3616 20.9072L12.355 20.9107L12.3523 20.9121C12.1323 21.0289 11.8677 21.0289 11.6477 20.9121L11.645 20.9107Z"/></svg>`,
    share: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.21721 10.9071C6.83295 10.2169 6.096 9.75 5.25 9.75C4.00736 9.75 3 10.7574 3 12C3 13.2426 4.00736 14.25 5.25 14.25C6.096 14.25 6.83295 13.7831 7.21721 13.0929M7.21721 10.9071C7.39737 11.2307 7.5 11.6034 7.5 12C7.5 12.3966 7.39737 12.7693 7.21721 13.0929M7.21721 10.9071L16.7828 5.5929M7.21721 13.0929L16.7828 18.4071M16.7828 18.4071C16.6026 18.7307 16.5 19.1034 16.5 19.5C16.5 20.7426 17.5074 21.75 18.75 21.75C19.9926 21.75 21 20.7426 21 19.5C21 18.2574 19.9926 17.25 18.75 17.25C17.904 17.25 17.1671 17.7169 16.7828 18.4071ZM16.7828 5.5929C17.1671 6.28309 17.904 6.75 18.75 6.75C19.9926 6.75 21 5.74264 21 4.5C21 3.25736 19.9926 2.25 18.75 2.25C17.5074 2.25 16.5 3.25736 16.5 4.5C16.5 4.89664 16.6026 5.26931 16.7828 5.5929Z" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    plus: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5V19M5 12H19" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    ,
    // Pencil/edit icon used for renaming folders.  Stroke colour is inherited
    // from CSS so it matches the accent colour when rendered.  The viewBox
    // coordinates align with the other icons.
    edit: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.586 3.586a2 2 0 012.828 0l2.414 2.414a2 2 0 010 2.828l-9.192 9.192a2 2 0 01-.707.414l-4.707 1.571a1 1 0 01-1.265-1.265l1.571-4.707a2 2 0 01.414-.707l9.192-9.192zM2 15.414l-.707.707L7.172 22H12v-4.828l-5.828-5.828L2 15.414z" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  };

  // Build each action icon and attach appropriate event handlers
  const actions = ['reply', 'retweet', 'like', 'share', 'plus'];
  actions.forEach((key) => {
    const span = document.createElement('span');
    span.classList.add(key);
    // Set icon based on liked state for like
    if (key === 'like') {
      if (isTweetLiked(text)) {
        span.classList.add('liked');
        span.innerHTML = icons.likeFilled;
      } else {
        span.innerHTML = icons.like;
      }
    } else {
      span.innerHTML = icons[key];
    }
    // Attach event listeners
    // Both the retweet and share icons trigger the share menu on hover.
    if (key === 'retweet' || key === 'share') {
      // Show the menu when hovering over the icon
      span.addEventListener('mouseenter', (e) => {
        showShareMenu(e, text);
      });
      // Schedule hide when leaving the icon. We delay a bit to allow
      // the pointer to move into the menu itself without closing it.
      span.addEventListener('mouseleave', () => {
        if (shareHideTimer) clearTimeout(shareHideTimer);
        shareHideTimer = setTimeout(() => {
          clearShareMenus();
        }, 150);
      });
      // Also allow clicking the icon to toggle the share menu. This makes
      // sharing accessible to users who prefer clicking over hovering. We
      // stop propagation to avoid triggering other click handlers.
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        showShareMenu(e, text);
      });
    }
    if (key === 'like') {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        // Toggle like state
        if (span.classList.contains('liked')) {
          span.classList.remove('liked');
          span.innerHTML = icons.like;
          // Remove from storage
          unlikeTweet(text);
        } else {
          span.classList.add('liked');
          span.innerHTML = icons.likeFilled;
          // Save with metadata: article name and author handle
          // Retrieve source URL and mode from the tweet element's data attributes
          const url = tweetEl.dataset.sourceurl || '';
          const mode = tweetEl.dataset.mode || currentMode;
          likeTweet(text, name, handle, url, mode);
          // Trigger a small burst animation to emulate Twitter's heart effect
          animateHeartBurst(span);
        }
        renderSavedTweets();
      });
    }
    // The plus icon opens a folder menu to organise favourite tweets. A burst
    // animation plays on click. It supports hover like the share menu.
    if (key === 'plus') {
      // The plus icon opens a folder menu to organise tweets into named
      // folders. We support both hover and click interactions. Hovering
      // will show the menu and leaving will schedule it to close. Clicking
      // will also show the menu and trigger a burst effect. The menu
      // itself manages its own hover to remain open while the pointer
      // is over it.
      span.addEventListener('mouseenter', (e) => {
        showPlusMenu(e, { text, name, handle });
      });
      span.addEventListener('mouseleave', () => {
        if (plusHideTimer) clearTimeout(plusHideTimer);
        plusHideTimer = setTimeout(() => {
          clearPlusMenus();
        }, 150);
      });
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        showPlusMenu(e, { text, name, handle });
        animateHeartBurst(span);
      });
    }
    // When the reply (back arrow) icon is clicked, flip the tweet like a
    // sheet of paper and remove it from view. Also close any open share menus.
    if (key === 'reply') {
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        tweetEl.classList.add('flip-out');
        clearShareMenus();
        setTimeout(() => {
          tweetEl.remove();
        }, 600);
      });
    }
    actionsEl.appendChild(span);
  });
  tweetEl.appendChild(actionsEl);

  // Thread index (e.g. 1/5). This helps orient readers when the
  // article is split into multiple tweets. Only show if there is more
  // than one tweet.
  if (total > 1) {
    const indexEl = document.createElement('div');
    indexEl.classList.add('tweet-index');
    indexEl.textContent = `${index + 1}/${total}`;
    tweetEl.appendChild(indexEl);
  }

  return tweetEl;
}

// ----- Enhanced UI Insertion -----

/**
 * Initialise all additional controls and UI elements required for the extended
 * Thought Bank functionality. This function is called once on page load
 * after the base DOM has been rendered. It inserts controls such as the
 * mode selector, statistics bar, source URL input, global export menu,
 * aria-live region, bulk selection toolbar, and focus mode toggle.
 */
function initEnhancedUI() {
  // The segmented mode toggle has been replaced with a vertical slider
  // integrated into the drop zone. Do not insert the old control.
  // Do not insert the statistics bar; the read time and snippet
  // counters have been removed for a cleaner interface.
  // Source URL input has been removed for a simpler interface.
  // insertSourceURLInput();
  insertGlobalExportMenu();
  insertAriaLiveRegion();
  insertBulkToolbar();
  insertFocusToggle();
  attachInputListeners();
  insertPdfNoteHandler();
}

/**
 * Insert the mode control segmented selector. This control allows users
 * to choose between sentence, paragraph or 280-character chunking. It
 * replaces the default placement of the Generate button by grouping
 * both controls in a new action row. The Generate button remains
 * functional and retains its ID.
 */
function insertModeControl() {
  // Existing generate button and mode toggle container are created
  // directly in the HTML. Populate the toggle container (#modeToggle)
  // with our chunking options (Sentence, Paragraph, Tweet Mode) and
  // update the current mode when a button is clicked.
  const toggleContainer = document.getElementById('modeToggle');
  if (!toggleContainer) return;
  // Clear any existing options
  toggleContainer.innerHTML = '';
  const modes = [
    { label: 'Sentence', value: 'sentence' },
    { label: 'Paragraph', value: 'paragraph' },
    { label: 'Tweet Mode', value: '280' },
  ];
  modes.forEach(({ label, value }, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.mode = value;
    if (value === currentMode) {
      btn.classList.add('active');
    }
    btn.addEventListener('click', () => {
      if (currentMode !== value) {
        currentMode = value;
        // Update active state for all buttons
        toggleContainer.querySelectorAll('button').forEach((el) => {
          el.classList.toggle('active', el.dataset.mode === currentMode);
        });
        // Update stats bar on mode change
        updateStatsBar();
      }
    });
    toggleContainer.appendChild(btn);
  });
}

/**
 * Insert a statistics bar beneath the action row. The bar displays
 * approximate reading time and snippet counts depending on the current
 * chunking mode and the content of the article input. It updates
 * whenever the input text or mode changes. The element is created
 * only once.
 */
// The statistics bar has been removed from this build. To preserve
// backward compatibility, insertStatsBar() is defined as a no‑op.
function insertStatsBar() {
  // intentionally blank
}

/**
 * Create and insert a Source URL input field after the Author input. The
 * input allows users to specify the original URL of the article or
 * paper. It uses the same styling as existing inputs by reusing
 * the .input-field class. The ID of the input is set to 'sourceURL'.
 */
function insertSourceURLInput() {
  const handleInput = document.getElementById('handle');
  if (!handleInput) return;
  const label = document.createElement('label');
  label.classList.add('input-field');
  label.textContent = 'Source URL';
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'sourceURL';
  input.placeholder = 'Source URL';
  label.appendChild(input);
  // Insert after the handle input's parent label
  const parentLabel = handleInput.parentElement;
  parentLabel.parentElement.insertBefore(label, parentLabel.nextSibling);
}

/**
 * Insert the global export kebab menu into the Saved Tweets header. The
 * kebab button reveals a menu with options to export all saved
 * snippets as Markdown or JSON, save the current session, or load a
 * previously saved session. The menu is hidden by default and is
 * shown/hidden via mouse events.
 */
function insertGlobalExportMenu() {
  const header = document.querySelector('#savedSection .saved-header');
  if (!header) return;
  // Create container for the kebab button and ensure it's right-aligned
  const kebabContainer = document.createElement('div');
  kebabContainer.classList.add('kebab-container');
  const kebabBtn = document.createElement('button');
  kebabBtn.classList.add('kebab-btn');
  kebabBtn.setAttribute('aria-label', 'More options');
  kebabBtn.innerHTML = '&#8942;'; // vertical ellipsis
  kebabContainer.appendChild(kebabBtn);
  header.appendChild(kebabContainer);
  // Build the export menu
  const menu = document.createElement('div');
  menu.classList.add('export-menu');
  menu.style.display = 'none';
  // Helper to create menu items
  function addMenuItem(label, handler) {
    const item = document.createElement('div');
    item.classList.add('export-item');
    item.textContent = label;
    item.addEventListener('click', (e) => {
      e.preventDefault();
      handler();
      menu.style.display = 'none';
    });
    menu.appendChild(item);
  }
  addMenuItem('Export as Markdown', () => {
    exportAllSaved('markdown');
  });
  addMenuItem('Export as JSON', () => {
    exportAllSaved('json');
  });
  addMenuItem('Save Session', () => {
    saveSession();
  });
  addMenuItem('Load Session', () => {
    loadSession();
  });
  // Append the menu to the kebab container so that mouse events
  // propagate correctly. When the menu is a child of the container,
  // moving the pointer into the menu does not trigger a mouseleave
  // on the container. This avoids flickering/glitchy behaviour.
  kebabContainer.appendChild(menu);
  // Show the export menu when hovering over the kebab. Position the
  // menu just below the button. Use mouseenter and mouseleave
  // events so that the dots remain stationary and the menu appears
  // gracefully without pushing the icon.
  kebabContainer.addEventListener('mouseenter', () => {
    // Hide any other open export menus
    document.querySelectorAll('.export-menu').forEach((m) => {
      if (m !== menu) m.style.display = 'none';
    });
    menu.style.display = 'block';
  });
  kebabContainer.addEventListener('mouseleave', () => {
    menu.style.display = 'none';
  });
}

/**
 * Create a hidden aria-live region for announcing copy actions. This
 * improves screen reader accessibility by providing audible feedback
 * when users copy text. The region is appended to the body and
 * removed after announcements.
 */
function insertAriaLiveRegion() {
  ariaLiveRegion = document.createElement('div');
  ariaLiveRegion.setAttribute('aria-live', 'polite');
  ariaLiveRegion.classList.add('visually-hidden');
  document.body.appendChild(ariaLiveRegion);
}

/**
 * Insert a bulk toolbar that appears when one or more snippets are
 * selected via their checkboxes. The toolbar floats at the bottom
 * right of the container and offers actions: copy selected, export
 * selected as Markdown, export selected as JSON. Initially hidden.
 */
function insertBulkToolbar() {
  const toolbar = document.createElement('div');
  toolbar.id = 'bulkToolbar';
  toolbar.classList.add('bulk-toolbar');
  toolbar.style.display = 'none';
  // Copy selected
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy selected';
  copyBtn.addEventListener('click', () => {
    copySelectedSnippets();
  });
  toolbar.appendChild(copyBtn);
  // Export selected (MD)
  const exportMdBtn = document.createElement('button');
  exportMdBtn.textContent = 'Export selected (MD)';
  exportMdBtn.addEventListener('click', () => {
    exportSelected('markdown');
  });
  toolbar.appendChild(exportMdBtn);
  // Export selected (JSON)
  const exportJsonBtn = document.createElement('button');
  exportJsonBtn.textContent = 'Export selected (JSON)';
  exportJsonBtn.addEventListener('click', () => {
    exportSelected('json');
  });
  toolbar.appendChild(exportJsonBtn);
  document.body.appendChild(toolbar);
}

/**
 * Insert a focus mode toggle link into the stats bar. When clicked,
 * focus mode presents snippets one at a time in the centre of the
 * screen with arrow navigation. Clicking again exits focus mode.
 */
function insertFocusToggle() {
  const stats = document.getElementById('statsBar');
  if (!stats) return;
  const toggle = document.createElement('a');
  toggle.href = '#';
  toggle.id = 'focusToggle';
  toggle.textContent = 'Focus Mode';
  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    toggleFocusMode();
  });
  // Prepend a separator if stats bar already has content
  if (stats.textContent.trim().length > 0) {
    const separator = document.createTextNode(' | ');
    stats.appendChild(separator);
  }
  stats.appendChild(toggle);
}

// ----- Utility and action functions for enhanced features -----

/**
 * Copy a string to the clipboard. Uses the Clipboard API when
 * available, otherwise falls back to a temporary textarea. After
 * copying, announces success via the aria-live region.
 *
 * @param {string} str
 */
function copyToClipboard(str) {
  if (!str) return;
  function done() {
    announce('Copied!');
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(str).then(done, done);
  } else {
    const ta = document.createElement('textarea');
    ta.value = str;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      // ignored
    }
    document.body.removeChild(ta);
    done();
  }
}

/**
 * Announce a message via the aria-live region. This is used for
 * accessibility announcements such as copy confirmation. The message
 * is cleared after a short delay to prevent repeated announcements.
 *
 * @param {string} message
 */
function announce(message) {
  if (!ariaLiveRegion) return;
  ariaLiveRegion.textContent = message;
  setTimeout(() => {
    ariaLiveRegion.textContent = '';
  }, 1000);
}

/**
 * Show or hide the bulk toolbar depending on the number of selected
 * snippets. When at least one snippet is selected, the toolbar
 * becomes visible. Otherwise it hides. This function should be
 * invoked whenever the selection set changes.
 */
function updateBulkToolbar() {
  const toolbar = document.getElementById('bulkToolbar');
  if (!toolbar) return;
  toolbar.style.display = selectedTweets.size > 0 ? 'flex' : 'none';
}

/**
 * Copy the contents of all currently selected snippets. Snippets are
 * concatenated with two newlines between them. A success announcement
 * is made via the aria-live region.
 */
function copySelectedSnippets() {
  if (selectedTweets.size === 0) return;
  const texts = [];
  selectedTweets.forEach((el) => {
    const body = el.querySelector('.tweet-content');
    if (body) texts.push(body.textContent.trim());
  });
  copyToClipboard(texts.join('\n\n'));
}

/**
 * Collect the snippet data (index, char count, text) from a tweet DOM
 * element. The index is derived from the displayed thread index if
 * present, otherwise the order in the selected set is used when
 * exporting. The char count is measured on the text content.
 *
 * @param {HTMLElement} el
 * @param {number} fallbackIndex
 * @returns {{index:number, chars:number, text:string}}
 */
function collectSnippetData(el, fallbackIndex = 0) {
  const textEl = el.querySelector('.tweet-content');
  const text = textEl ? textEl.textContent : '';
  const indexEl = el.querySelector('.tweet-index');
  let idx = fallbackIndex;
  if (indexEl) {
    const parts = indexEl.textContent.split('/');
    idx = parseInt(parts[0], 10) || fallbackIndex;
  }
  return { index: idx, chars: text.length, text };
}

/**
 * Create a Markdown string representing the provided meta data and
 * snippets. The format matches the specification. Each snippet has
 * its own heading with character count and is quoted using >. Line
 * breaks within snippets are preserved.
 *
 * @param {{title:string, author:string, sourceURL:string, mode:string}} meta
 * @param {Array<{index:number, chars:number, text:string}>} snippets
 * @returns {string}
 */
function createMarkdown(meta, snippets) {
  let md = '';
  md += `# ${meta.title}\n\n`;
  md += `**Author:** ${meta.author}\n`;
  md += `**Source:** ${meta.sourceURL || 'N/A'}\n`;
  md += `**Mode:** ${meta.mode}\n`;
  md += `**Exported:** ${new Date().toISOString()}\n\n`;
  md += '---\n';
  snippets.forEach((snip) => {
    md += `## Snippet ${snip.index} (${snip.chars} chars)\n\n`;
    // Quote each line to preserve formatting
    const lines = snip.text.split(/\n/);
    lines.forEach((line) => {
      md += `> ${line}\n`;
    });
    md += '\n';
  });
  return md;
}

/**
 * Create a JSON string representing the provided meta data and
 * snippets. The structure matches the specification exactly.
 *
 * @param {{title:string, author:string, sourceURL:string, mode:string}} meta
 * @param {Array<{index:number, chars:number, text:string}>} snippets
 * @returns {string}
 */
function createJSON(meta, snippets) {
  const obj = {
    meta: {
      title: meta.title,
      author: meta.author,
      sourceURL: meta.sourceURL || '',
      mode: meta.mode,
      exportedAt: new Date().toISOString(),
    },
    snippets: snippets.map((snip) => {
      return {
        index: snip.index,
        chars: snip.chars,
        text: snip.text,
      };
    }),
  };
  return JSON.stringify(obj, null, 2);
}

/**
 * Trigger a download of the provided content. A Blob is created
 * using the specified MIME type and a temporary anchor is clicked
 * programmatically to prompt the user to save the file.
 *
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export a collection of snippets in a given format. Determines the
 * meta information from the first snippet if available and uses the
 * current metadata fields as a fallback. Supported formats: 'markdown'
 * and 'json'. The generated file is automatically downloaded.
 *
 * @param {Array<HTMLElement>} elements
 * @param {'markdown'|'json'} format
 */
function exportSnippetElements(elements, format) {
  if (!elements || elements.length === 0) return;
  // Derive meta from the first element's data attributes
  const first = elements[0];
  const meta = {
    title: first.dataset.title || document.getElementById('name').value.trim() || 'Untitled',
    author: first.dataset.author || document.getElementById('handle').value.trim() || '',
    sourceURL: first.dataset.sourceurl || (document.getElementById('sourceURL') ? document.getElementById('sourceURL').value.trim() : ''),
    mode: first.dataset.mode || currentMode,
  };
  // Collect snippet data
  const snippets = elements.map((el, i) => collectSnippetData(el, i + 1));
  let content = '';
  let mime = '';
  let ext = '';
  if (format === 'markdown') {
    content = createMarkdown(meta, snippets);
    mime = 'text/markdown;charset=utf-8';
    ext = '.md';
  } else {
    content = createJSON(meta, snippets);
    mime = 'application/json;charset=utf-8';
    ext = '.json';
  }
  const safeTitle = meta.title.replace(/[^\w\-]+/g, '_').substring(0, 20) || 'snippets';
  const filename = `${safeTitle}_${Date.now()}${ext}`;
  downloadFile(content, filename, mime);
}

/**
 * Export all saved tweets in the specified format. This traverses
 * getLikedTweets() to collect snippet elements and uses
 * exportSnippetElements().
 *
 * @param {'markdown'|'json'} format
 */
function exportAllSaved(format) {
  const liked = getLikedTweets();
  if (liked.length === 0) return;
  // Create temporary DOM elements to reuse export logic. We don't
  // currently render saved tweets into tweet-like cards, so instead
  // create dummy elements with the necessary dataset and content.
  const elems = liked.map((entry, i) => {
    const div = document.createElement('div');
    div.dataset.title = entry.name || document.getElementById('name').value.trim() || 'Untitled';
    div.dataset.author = entry.handle || document.getElementById('handle').value.trim() || '';
    div.dataset.sourceurl = entry.url || (document.getElementById('sourceURL') ? document.getElementById('sourceURL').value.trim() : '');
    div.dataset.mode = entry.mode || currentMode;
    div.innerHTML = `<div class="tweet-content">${entry.text}</div><div class="tweet-index">${i + 1}/${liked.length}</div>`;
    return div;
  });
  exportSnippetElements(elems, format);
}

/**
 * Export only the currently selected snippets in the specified format. If
 * no snippets are selected, nothing happens. After exporting, the
 * selection remains unchanged.
 *
 * @param {'markdown'|'json'} format
 */
function exportSelected(format) {
  if (selectedTweets.size === 0) return;
  exportSnippetElements(Array.from(selectedTweets), format);
}

/**
 * Export the snippets in a specific folder. The folderName must
 * correspond to a key in the tweetFolders mapping. If the folder
 * contains no entries, the function does nothing. Folder-specific
 * export is triggered from the hover menu on each folder icon.
 *
 * @param {string} folderName
 * @param {'markdown'|'json'} format
 */
function exportFolder(folderName, format) {
  const folders = getTweetFolders();
  const entries = folders[folderName] || [];
  if (entries.length === 0) return;
  // Build temporary elements
  const elems = entries.map((entry, i) => {
    const div = document.createElement('div');
    div.dataset.title = entry.name || document.getElementById('name').value.trim() || 'Untitled';
    div.dataset.author = entry.handle || document.getElementById('handle').value.trim() || '';
    div.dataset.sourceurl = entry.url || (document.getElementById('sourceURL') ? document.getElementById('sourceURL').value.trim() : '');
    div.dataset.mode = entry.mode || currentMode;
    div.innerHTML = `<div class="tweet-content">${entry.text}</div><div class="tweet-index">${i + 1}/${entries.length}</div>`;
    return div;
  });
  exportSnippetElements(elems, format);
}

/**
 * Save the current session to a downloadable JSON file. The session
 * contains the raw article text, metadata fields (title, author,
 * source URL), current mode, the generated snippets, saved tweets
 * (likes), and folder assignments. The file can be reloaded later
 * via loadSession().
 */
function saveSession() {
  const session = {
    article: document.getElementById('articleInput').value || '',
    name: document.getElementById('name').value || '',
    handle: document.getElementById('handle').value || '',
    sourceURL: document.getElementById('sourceURL') ? document.getElementById('sourceURL').value : '',
    mode: currentMode,
    snippets: [],
    liked: getLikedTweets(),
    folders: getTweetFolders(),
  };
  // Capture current snippets from tweetsContainer
  const tweetEls = Array.from(document.querySelectorAll('#tweetsContainer .tweet'));
  tweetEls.forEach((el, i) => {
    const body = el.querySelector('.tweet-content');
    session.snippets.push({ index: i + 1, text: body ? body.textContent : '' });
  });
  const json = JSON.stringify(session, null, 2);
  const filename = `thoughtbank_session_${Date.now()}.json`;
  downloadFile(json, filename, 'application/json;charset=utf-8');
}

/**
 * Load a previously saved session from a JSON file. Prompts the user
 * with a file picker, reads the JSON, and restores the application
 * state. This includes article content, metadata, mode, snippets,
 * liked tweets and folder assignments. Existing state is replaced.
 */
function loadSession() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        // Restore raw text
        document.getElementById('articleInput').value = data.article || '';
        document.getElementById('name').value = data.name || '';
        document.getElementById('handle').value = data.handle || '';
        if (document.getElementById('sourceURL')) {
          document.getElementById('sourceURL').value = data.sourceURL || '';
        }
        currentMode = data.mode || '280';
        // Update mode control UI
        const modeButtons = document.querySelectorAll('.mode-control button');
        modeButtons.forEach((btn) => {
          btn.classList.toggle('selected', btn.dataset.mode === currentMode);
        });
        // Render snippets
        const chunks = chunkArticle(data.article || '', currentMode);
        const tweetsContainer = document.getElementById('tweetsContainer');
        tweetsContainer.innerHTML = '';
        const frag = document.createDocumentFragment();
        chunks.forEach((seg, idx) => {
          const tweetEl = createTweetElement(seg, data.name || '', '@' + (data.handle || '').replace(/^@/, ''), idx, chunks.length);
          tweetEl.dataset.title = data.name || '';
          tweetEl.dataset.author = data.handle || '';
          tweetEl.dataset.sourceurl = data.sourceURL || '';
          tweetEl.dataset.mode = currentMode;
          frag.appendChild(tweetEl);
        });
        tweetsContainer.appendChild(frag);
        lastSnippetCount = chunks.length;
        updateStatsBar();
        // Restore liked tweets
        setLikedTweets(data.liked || []);
        renderSavedTweets();
        // Restore folders
        setTweetFolders(data.folders || {});
        renderFolderIcons();
      } catch (err) {
        alert('Failed to load session: invalid file');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

/**
 * Toggle focus mode on or off. When enabling focus mode, the page
 * dims and only one snippet card is displayed in a centred overlay.
 * Arrow buttons and keyboard arrows allow navigation through the
 * snippets. Disabling focus mode restores the normal list view.
 */
function toggleFocusMode() {
  if (focusModeActive) {
    hideFocusOverlay();
    focusModeActive = false;
  } else {
    showFocusOverlay();
    focusModeActive = true;
  }
}

/**
 * Display the focus overlay showing one snippet at a time. The overlay
 * is created lazily and appended to the body. Navigation arrows and
 * an exit button are provided. Snippets are sourced from the current
 * tweetsContainer.
 */
function showFocusOverlay() {
  // Create overlay if not present
  let overlay = document.getElementById('focusOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'focusOverlay';
    overlay.classList.add('focus-overlay');
    // Card container
    const cardContainer = document.createElement('div');
    cardContainer.classList.add('focus-card');
    overlay.appendChild(cardContainer);
    // Navigation buttons
    const prevBtn = document.createElement('button');
    prevBtn.classList.add('focus-prev');
    prevBtn.textContent = '←';
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateFocus(-1);
    });
    const nextBtn = document.createElement('button');
    nextBtn.classList.add('focus-next');
    nextBtn.textContent = '→';
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateFocus(1);
    });
    // Exit button
    const exitBtn = document.createElement('button');
    exitBtn.classList.add('focus-exit');
    exitBtn.textContent = '×';
    exitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFocusMode();
    });
    overlay.appendChild(prevBtn);
    overlay.appendChild(nextBtn);
    overlay.appendChild(exitBtn);
    document.body.appendChild(overlay);
  }
  // Gather snippets
  const cards = Array.from(document.querySelectorAll('#tweetsContainer .tweet'));
  if (cards.length === 0) return;
  // Display the current card
  function displayCard() {
    const cardContainer = overlay.querySelector('.focus-card');
    cardContainer.innerHTML = '';
    const clone = cards[focusIndex].cloneNode(true);
    // Remove interactive elements (copy, checkbox, actions) for focus
    clone.querySelectorAll('.copy-btn, .tweet-select, .tweet-actions, .tweet-index').forEach((el) => el.remove());
    cardContainer.appendChild(clone);
  }
  // Set initial index and display
  focusIndex = 0;
  displayCard();
  overlay.style.display = 'flex';
  // Navigation helper stored for later use
  window.navigateFocus = function (delta) {
    focusIndex += delta;
    if (focusIndex < 0) focusIndex = cards.length - 1;
    if (focusIndex >= cards.length) focusIndex = 0;
    displayCard();
  };
}

/**
 * Hide the focus overlay and remove navigation helpers.
 */
function hideFocusOverlay() {
  const overlay = document.getElementById('focusOverlay');
  if (overlay) {
    overlay.style.display = 'none';
  }
  delete window.navigateFocus;
}

/**
 * Handle keyboard shortcuts. 1/2/3 switches chunking modes. Ctrl/Cmd+C
 * copies selected snippets if the bulk toolbar is visible. Arrow keys
 * navigate focus mode. Escape exits focus mode.
 *
 * @param {KeyboardEvent} e
 */
function handleKeydown(e) {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  // Mode shortcuts only if focus is not in an input element
  const tag = e.target.tagName.toLowerCase();
  const isInput = tag === 'input' || tag === 'textarea' || tag === 'button';
  if (!isInput && !focusModeActive) {
    if (e.key === '1') {
      currentMode = 'sentence';
    } else if (e.key === '2') {
      currentMode = 'paragraph';
    } else if (e.key === '3') {
      currentMode = '280';
    }
    // Update mode UI selection: update any segmented control and the
    // vertical slider. The segmented control may not exist if using
    // the slider only.
    document.querySelectorAll('.mode-control button').forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.mode === currentMode);
    });
    document.querySelectorAll('.slider-dot').forEach((dot) => {
      dot.classList.toggle('active', dot.dataset.mode === currentMode);
    });
    updateStatsBar();
  }
  // Copy selected via keyboard: Ctrl/Cmd + C
  if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'c') {
    if (document.getElementById('bulkToolbar') && selectedTweets.size > 0) {
      e.preventDefault();
      copySelectedSnippets();
    }
  }
  // Focus mode navigation
  if (focusModeActive) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (window.navigateFocus) window.navigateFocus(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (window.navigateFocus) window.navigateFocus(1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      toggleFocusMode();
    }
  }
}

/**
 * Attach debounced listeners to inputs to update the stats bar on
 * changes. This includes the article text area and the mode control
 * buttons. Debouncing prevents excessive recalculations when typing.
 */
function attachInputListeners() {
  const article = document.getElementById('articleInput');
  if (article) {
    article.addEventListener('input', () => {
      if (statsDebounceTimer) clearTimeout(statsDebounceTimer);
      statsDebounceTimer = setTimeout(() => {
        updateStatsBar();
      }, 300);
    });
  }
  // Update stats when Source URL changes (metadata). This does not affect
  // reading time but ensures the stats bar is re-rendered with current
  // values if needed.
  const source = document.getElementById('sourceURL');
  if (source) {
    source.addEventListener('input', () => {
      if (statsDebounceTimer) clearTimeout(statsDebounceTimer);
      statsDebounceTimer = setTimeout(() => {
        updateStatsBar();
      }, 300);
    });
  }
}

/**
 * Create a PDF note element and attach drag-and-drop listeners to the
 * article textarea. If a user drags a PDF file onto the textarea, the
 * drop event is intercepted and a note is displayed informing them
 * that PDF extraction isn't supported in this offline build. The
 * note auto-hides after a few seconds or when the input changes.
 */
function insertPdfNoteHandler() {
  const input = document.getElementById('articleInput');
  if (!input) return;
  // Create note element if not already present
  let note = document.getElementById('pdfNote');
  if (!note) {
    note = document.createElement('div');
    note.id = 'pdfNote';
    note.classList.add('pdf-note');
    note.textContent = "PDF text extraction isn’t supported in this offline build. Convert to text and re-upload.";
    note.style.display = 'none';
    input.parentElement.appendChild(note);
  }
  // Prevent default behaviour for dragover so drop will fire
  input.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  input.addEventListener('drop', (e) => {
    e.preventDefault();
    const items = e.dataTransfer?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file && file.type === 'application/pdf') {
            note.style.display = 'block';
            setTimeout(() => {
              note.style.display = 'none';
            }, 5000);
            return;
          }
        }
      }
    }
  });
  // Hide note when input changes
  input.addEventListener('input', () => {
    note.style.display = 'none';
  });
}

/**
 * Update the statistics bar with the current reading time estimate and
 * progress information. Reading time is calculated at 200 words per
 * minute. Progress is displayed when snippets have been generated,
 * showing the number of snippets and an estimated consumption time
 * of 6 snippets per minute. The bar updates gracefully without
 * causing layout shifts.
 */
function updateStatsBar() {
  // No operation. The stats bar has been removed from this build,
  // therefore this function is intentionally left blank.
}

// Main logic: wire up the generate button
document.addEventListener('DOMContentLoaded', () => {
  const generateBtn = document.getElementById('generateBtn');
  const tweetsContainer = document.getElementById('tweetsContainer');
  const dropZone = document.getElementById('dropZone');
  const articleInput = document.getElementById('articleInput');
  const modeToggle = document.getElementById('modeToggle');

  // Hide the primary action button. The interface now processes
  // articles automatically when they are dropped or pasted. Keeping
  // the button hidden ensures keyboard accessibility without
  // exposing an unnecessary control to the user.
  if (generateBtn) {
    generateBtn.style.display = 'none';
  }
  // Create an article view container dynamically. This will hold the
  // stitched longform article when the user switches to Article Mode.
  const articleView = document.createElement('div');
  articleView.id = 'articleView';
  articleView.className = 'article-view';
  articleView.style.display = 'none';
  // Append the article view after the tweets container
  tweetsContainer.parentNode.insertBefore(articleView, tweetsContainer.nextSibling);

  // Initialise the mode toggle segmented control. Scroll Mode is
  // active by default. When toggled, it switches the view between
  // individual cards and the full article. Use a button group for
  // accessibility and styling consistency.
  function initModeToggle() {
    const modes = [
      { key: 'scroll', label: 'Scroll Mode' },
      { key: 'article', label: 'Article Mode' }
    ];
    modes.forEach(({ key, label }, index) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.dataset.modeSwitch = key;
      if (index === 0) btn.classList.add('active');
      btn.addEventListener('click', () => {
        // Remove active from all
        Array.from(modeToggle.children).forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        setViewMode(key);
      });
      modeToggle.appendChild(btn);
    });
  }

  /**
   * Switch between scroll (card) and article modes. In scroll mode
   * the tweets container is shown; in article mode it is hidden and
   * the stitched article is displayed. This function also sets up
   * auto-scroll observers when entering scroll mode.
   *
   * @param {'scroll'|'article'} modeKey
   */
  function setViewMode(modeKey) {
    if (modeKey === 'article') {
      // Compose the full article from current input and display it.
      const text = articleInput.value.trim();
      articleView.textContent = text;
      articleView.style.display = 'block';
      tweetsContainer.style.display = 'none';
      // Remove any auto-scroll observers if previously set
      cleanupAutoScroll();
    } else {
      // Show the card feed and hide the full article.
      articleView.style.display = 'none';
      tweetsContainer.style.display = '';
      // Set up auto-scroll watchers when returning to scroll mode
      setupAutoScroll();
    }
  }

  // Debounced auto-scroll observers to prevent repeated creation.
  let autoScrollObservers = [];
  function cleanupAutoScroll() {
    autoScrollObservers.forEach((obs) => obs.disconnect());
    autoScrollObservers = [];
  }
  function setupAutoScroll() {
    // Auto‑scroll has been disabled. Users control scrolling
    // manually. No observers are created.
    cleanupAutoScroll();
  }

  // Handle pasted or dropped text. This function updates the hidden
  // textarea with the provided content, then triggers tweet
  // generation. It also clears the drop prompt.
  function handleArticleContent(text) {
    if (!text) return;
    articleInput.value = text;
    // Hide the prompt once content is provided
    const prompt = dropZone.querySelector('.drop-prompt');
    if (prompt) prompt.style.display = 'none';
    // Trigger generation directly without relying on the hidden button.
    generateSnippets();
  }

  // Setup drop zone events. We support dragover, dragleave, drop,
  // and paste events to provide a seamless experience.
  function initDropZone() {
    // Highlight on drag over
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      // If files are dropped, try to read the first one as text
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        const file = files[0];
        const reader = new FileReader();
        reader.onload = (ev) => {
          const content = ev.target.result;
          handleArticleContent(content);
        };
        reader.readAsText(file);
      } else {
        // Otherwise, use plain text from the drop
        const data = e.dataTransfer.getData('text/plain');
        handleArticleContent(data);
      }
    });
    // Paste handler
    dropZone.addEventListener('paste', (e) => {
      e.preventDefault();
      const clipboardData = e.clipboardData || window.clipboardData;
      const text = clipboardData.getData('text/plain');
      handleArticleContent(text);
    });
  }
  /**
   * Generate tweet snippets from the current article text using the
   * selected chunking mode. This function was previously bound to
   * the primary action button but is now invoked directly when
   * content is provided. It clears any existing tweets, splits the
   * article, renders the cards and refreshes the saved list. Auto
   * scrolling is disabled for a calmer reading experience.
   */
  function generateSnippets() {
    const name = document.getElementById('name').value.trim() || 'User';
    // Build the handle by stripping any leading @ and removing spaces. Then
    // prefix with @. For example, "Megha Lilly" becomes "@MeghaLilly".
    let handleRaw = document.getElementById('handle').value.trim();
    handleRaw = handleRaw.replace(/^@/, '').replace(/\s+/g, '');
    const handle = '@' + handleRaw;
    const article = document.getElementById('articleInput').value;
    const sourceUrlInput = document.getElementById('sourceURL');
    const sourceUrl = sourceUrlInput ? sourceUrlInput.value.trim() : '';
    // Clear previous tweets
    tweetsContainer.innerHTML = '';
    // Chunk according to current mode
    const chunks = chunkArticle(article, currentMode);
    // Handle no content
    if (chunks.length === 0) {
      const msg = document.createElement('p');
      msg.textContent = 'Please paste some text to generate snippets.';
      tweetsContainer.appendChild(msg);
      clearShareMenus();
      lastSnippetCount = 0;
      // Stats bar removed; skip updateStatsBar
      return;
    }
    // Create a document fragment for performance
    const frag = document.createDocumentFragment();
    chunks.forEach((segment, index) => {
      const tweetEl = createTweetElement(segment, name, handle, index, chunks.length);
      // Attach metadata to the tweet element for export
      tweetEl.dataset.title = name;
      tweetEl.dataset.author = handle;
      tweetEl.dataset.sourceurl = sourceUrl;
      tweetEl.dataset.mode = currentMode;
      frag.appendChild(tweetEl);
    });
    tweetsContainer.appendChild(frag);
    lastSnippetCount = chunks.length;
    // Stats bar removed; skip updateStatsBar
    // Clear any share menus and refresh saved list
    clearShareMenus();
    renderSavedTweets();
    // Ensure auto-scroll observers are removed to avoid rapid scrolling
    cleanupAutoScroll();
  }

  /**
   * Initialise the vertical mode slider inside the drop zone. The slider
   * has three dots representing the available chunking modes: paragraph
   * (top), tweet mode (middle) and sentence (bottom). Users can click
   * a dot or drag along the slider to change the current mode. The
   * active dot is highlighted with the accent colour.
   */
  function initModeSlider() {
    const slider = document.querySelector('.mode-slider');
    if (!slider) return;
    const dots = slider.querySelectorAll('.slider-dot');
    // Helper to update dot highlighting based on currentMode
    function updateActive() {
      dots.forEach((dot) => {
        dot.classList.toggle('active', dot.dataset.mode === currentMode);
      });
    }
    updateActive();
    // Click on individual dots
    dots.forEach((dot) => {
      dot.addEventListener('click', (e) => {
        const mode = dot.dataset.mode;
        if (mode && currentMode !== mode) {
          currentMode = mode;
          updateActive();
          updateStatsBar();
          showModeLabel(mode);
        }
        e.stopPropagation();
      });
    });
    // Dragging on the slider
    let dragging = false;
    function handlePointer(y) {
      const rect = slider.getBoundingClientRect();
      const rel = (y - rect.top) / rect.height;
      let mode;
      if (rel < 0.33) mode = 'paragraph';
      else if (rel < 0.66) mode = '280';
      else mode = 'sentence';
      if (mode !== currentMode) {
        currentMode = mode;
        updateActive();
        updateStatsBar();
        showModeLabel(mode);
      }
    }
    slider.addEventListener('mousedown', (e) => {
      dragging = true;
      handlePointer(e.clientY);
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      handlePointer(e.clientY);
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  /**
   * Display a temporary mode label next to the slider. It appears
   * when the user changes the mode and fades out after 1.5s. The
   * label position is adjusted to align with the active dot.
   *
   * @param {string} mode The newly selected mode
   */
  function showModeLabel(mode) {
    const slider = document.querySelector('.mode-slider');
    if (!slider) return;
    let label = slider.querySelector('.mode-label');
    if (!label) {
      label = document.createElement('div');
      label.className = 'mode-label';
      slider.appendChild(label);
    }
    // Set label text based on mode
    let text;
    if (mode === 'paragraph') text = 'Paragraph Mode';
    else if (mode === '280') text = 'Tweet Mode';
    else text = 'Sentence Mode';
    label.textContent = text;
    // Position the label vertically aligned to the active dot
    const activeDot = slider.querySelector(`.slider-dot[data-mode="${mode}"]`);
    if (activeDot) {
      // Compute offset relative to slider
      const sliderRect = slider.getBoundingClientRect();
      const dotRect = activeDot.getBoundingClientRect();
      const offsetY = dotRect.top + dotRect.height / 2 - sliderRect.top;
      label.style.top = `${offsetY}px`;
    }
    // Show label
    label.style.opacity = '1';
    // Clear any existing fade timers
    if (label.fadeTimeout) {
      clearTimeout(label.fadeTimeout);
    }
    // After 1.5 seconds, fade it out
    label.fadeTimeout = setTimeout(() => {
      label.style.opacity = '0';
    }, 1500);
  }

  // Initialize drop zone for pasting/dropping articles when the page loads
  initDropZone();
  initModeSlider();
  // Render any previously saved tweets on page load
  renderSavedTweets();
  // Render existing folder icons on load
  renderFolderIcons();

  // Initialise extended UI elements (mode control, stats bar, source URL input,
  // global export menu, aria-live region, bulk toolbar, focus toggle). These
  // functions inject new controls into the DOM without modifying the
  // existing HTML structure. They should be called once on load.
  initEnhancedUI();
  // Stats bar has been removed. No initial update is needed.

  // Keyboard shortcuts: switch modes via 1/2/3 keys and copy selected with
  // Ctrl/Cmd+C. Also handle navigation in focus mode via arrow keys.
  document.addEventListener('keydown', handleKeydown);

  // Attach click delegation on the folder icons container. Some users
  // reported difficulty opening folders when clicking on the icon or
  // label. By listening on the parent container and walking up the
  // DOM tree, we reliably detect clicks on any part of a folder
  // wrapper. When a folder is clicked, its name is retrieved from
  // data-folder-name and the folder view is opened.
  const folderIconsContainer = document.getElementById('folderIcons');
  if (folderIconsContainer) {
    folderIconsContainer.addEventListener('click', (evt) => {
      let target = evt.target;
      // Traverse up through parents until we find a folder wrapper or
      // reach the container itself
      while (target && target !== folderIconsContainer && !target.dataset.folderName) {
        target = target.parentElement;
      }
      if (target && target.dataset.folderName) {
        evt.stopPropagation();
        showFolderView(target.dataset.folderName);
      }
    });
  }

  // Attach handler to the add-folder (+) button. When clicked, prompt the
  // user for a new folder name, create the folder, and animate a
  // burst effect on the icon similar to the heart effect.
  const addFolderBtn = document.getElementById('addFolder');
  if (addFolderBtn) {
    addFolderBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = prompt('Enter a name for your new folder:');
      if (name && name.trim()) {
        addFolder(name.trim());
        // Trigger a burst animation using the same function as the heart
        animateHeartBurst(addFolderBtn);
      }
    });
  }
  generateBtn.addEventListener('click', () => {
    // Delegates to the unified generation function. The hidden
    // button remains accessible for keyboard users but is not
    // visible in the UI. This call will clear existing tweets,
    // split the article, and render the snippets.
    generateSnippets();
  });
});