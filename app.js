const CSV_FILES = [
  {
    path: './raw-schema/TimeEdit_DA211A-HT2026-TS070_Introduktion_till_studier_i_datavetenskap_2026-08-31_12_32.csv',
    courseCode: 'DA211A',
    courseName: 'Introduktion till studier i datavetenskap'
  },
  {
    path: './raw-schema/TimeEdit_DA339A-HT2026-TS067_Objektorienterad_programmering_2026-08-31_12_32.csv',
    courseCode: 'DA339A',
    courseName: 'Objektorienterad programmering'
  }
];

// ponytail: fixed 07:00–21:00 window covers this schedule's hours; widen if a course meets outside it
const GRID_START_MIN = 7 * 60;
const GRID_END_MIN = 21 * 60;
const GRID_SLOT_MIN = 15;
const GRID_ROWS = (GRID_END_MIN - GRID_START_MIN) / GRID_SLOT_MIN;
const GRID_SLOT_PX = 16; // must match the 16px row height in .grid-view's grid-template-rows

const CUSTOM_EVENTS_KEY = 'schema-custom-events';
const DIMMED_EVENTS_KEY = 'schema-dimmed-events';

function loadCustomEvents() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_EVENTS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCustomEvents() {
  localStorage.setItem(CUSTOM_EVENTS_KEY, JSON.stringify(state.customEvents));
}

function loadDimmed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DIMMED_EVENTS_KEY)) || []);
  } catch {
    return new Set();
  }
}

function saveDimmed() {
  localStorage.setItem(DIMMED_EVENTS_KEY, JSON.stringify([...state.dimmed]));
}

const NOTES_KEY = 'schema-notes';

function loadNotes() {
  try {
    return JSON.parse(localStorage.getItem(NOTES_KEY)) || {};
  } catch {
    return {};
  }
}

function saveNotes() {
  localStorage.setItem(NOTES_KEY, JSON.stringify(state.notes));
}

const state = {
  events: [],
  selectedCourse: 'Alla',
  sortMode: 'date',
  deadlineMode: 'all',
  weekStart: null,
  panelOpen: false,
  view: 'list',
  customEvents: loadCustomEvents(),
  dimmed: loadDimmed(),
  selectedCustomId: null,
  notes: loadNotes()
};

const CUSTOM_EVENT_DEFAULT_COLOR = '#fbe4dc';

const eventListEl = document.getElementById('eventList');
const courseFiltersEl = document.getElementById('courseFilters');
const searchInputEl = document.getElementById('searchInput');
const sortSegEl = document.getElementById('sortSeg');
const deadlineToggleEl = document.getElementById('deadlineToggle');
const totalEventsEl = document.getElementById('totalEvents');
const totalCoursesEl = document.getElementById('totalCourses');
const totalDeadlinesEl = document.getElementById('totalDeadlines');
const weekRangeEl = document.getElementById('weekRange');
const weekSubEl = document.getElementById('weekSub');
const prevWeekButtonEl = document.getElementById('prevWeek');
const nextWeekButtonEl = document.getElementById('nextWeek');
const togglePanelEl = document.getElementById('togglePanel');
const filterPanelEl = document.getElementById('filterPanel');
const panelStatusEl = document.getElementById('panelStatus');
const panelCaretEl = document.getElementById('panelCaret');
const gridToggleEl = document.getElementById('gridToggle');
const gridViewEl = document.getElementById('gridView');
const gridTimeSummaryEl = document.getElementById('gridTimeSummary');
const appShellEl = document.querySelector('.app-shell');

async function loadSchedule() {
  try {
    const loadedFiles = await Promise.all(
      CSV_FILES.map(async (file) => {
        const response = await fetch(file.path, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Kunde inte läsa ${file.path}`);
        }
        return parseScheduleFile(await response.text(), file);
      })
    );

    state.events = loadedFiles.flat().sort((a, b) => timestamp(a) - timestamp(b));

    if (state.events.length > 0) {
      state.weekStart = startOfWeek(new Date(`${state.events[0].date}T00:00:00`));
    }

    renderFilters();
    renderWeekView();
    updateSummary();
  } catch (error) {
    eventListEl.innerHTML = `<div class="empty-state">Det gick inte att läsa scheman. ${escapeHtml(error.message)}</div>`;
  }
}

function parseScheduleFile(csvText, fileMeta) {
  const rows = parseCsv(csvText);
  const headerIndex = rows.findIndex((row) => row.includes('Startdatum'));
  if (headerIndex === -1) return [];

  const headers = rows[headerIndex].map((column) => column.trim());

  return rows
    .slice(headerIndex + 1)
    .filter((row) => row.length > 0 && row.some((value) => value && value.trim() !== ''))
    .map((row, index) => {
      const entry = {};
      headers.forEach((header, headerIndexValue) => {
        entry[header] = row[headerIndexValue] ?? '';
      });

      const date = cleanValue(entry.Startdatum);
      const start = cleanValue(entry.Starttid);
      if (!date || !start) return null;

      const programCode = cleanValue(entry.Program);
      const courseGroup = cleanValue(entry['Kurs,Grupp']);

      return {
        id: `${fileMeta.courseCode}-${date}-${start}-${index}`,
        date,
        start,
        end: cleanValue(entry.Sluttid),
        title: cleanValue(entry.Momenttext) || cleanValue(entry.Undervisningstyp) || 'Schemamoment',
        courseCode: fileMeta.courseCode,
        courseName: fileMeta.courseName,
        type: cleanValue(entry.Undervisningstyp),
        location: cleanValue(entry.Lokal),
        teacher: cleanValue(entry.Lärare),
        program: programCode,
        group: courseGroup,
        teachingGroup: resolveTeachingGroup(programCode, courseGroup)
      };
    })
    .filter(Boolean);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(value);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      value = '';
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  }

  return rows;
}

function cleanValue(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function timestamp(event) {
  return new Date(`${event.date}T${event.start || '00:00'}:00`).getTime();
}

function renderFilters() {
  const courses = ['Alla', ...new Set(state.events.map((event) => event.courseName))];

  courseFiltersEl.innerHTML = courses
    .map((course) => {
      const activeClass = course === state.selectedCourse ? 'active' : '';
      const label = course === 'Alla' ? 'Alla kurser' : course;
      return `<button type="button" class="chip ${activeClass}" data-course="${escapeHtml(course)}">${escapeHtml(label)}</button>`;
    })
    .join('');

  courseFiltersEl.querySelectorAll('.chip').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedCourse = button.dataset.course;
      renderFilters();
      renderWeekView();
      updatePanelStatus();
    });
  });
}

function matchesFilters(event) {
  const searchText = searchInputEl.value.trim().toLowerCase();
  const matchesCourse = state.selectedCourse === 'Alla' || event.courseName === state.selectedCourse;
  const matchesDeadline =
    state.deadlineMode === 'all'
      ? true
      : state.deadlineMode === 'only'
        ? isDeadlineEvent(event)
        : !isDeadlineEvent(event);
  const matchesSearch = !searchText || [
    event.title,
    event.courseName,
    event.courseCode,
    event.type,
    event.location,
    event.teacher,
    event.program,
    event.group,
    event.teachingGroup ? `Undervisningsgrupp ${event.teachingGroup}` : ''
  ].join(' ').toLowerCase().includes(searchText);

  return matchesCourse && matchesDeadline && matchesSearch;
}

function resolveTeachingGroup(programValue, groupValue) {
  const combined = `${programValue || ''} ${groupValue || ''}`;
  const matches = [...new Set(
    combined
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => token.match(/-(\d+)$/))
      .filter(Boolean)
      .map((match) => Number(match[1]))
      .filter((value) => value === 1 || value === 2)
  )];

  if (matches.length === 0) return null;
  return matches.includes(1) && matches.includes(2) ? '1, 2' : String(matches[0]);
}

function eventHtml(event) {
  const isDeadline = isDeadlineEvent(event);
  const past = isPastEvent(event);
  const teachingGroup = event.teachingGroup ? `Undervisningsgrupp ${event.teachingGroup}` : null;

  return `
    <article class="day-event-card ${isDeadline ? 'deadline' : ''} ${past ? 'past' : ''}">
      <div class="bar"></div>
      <div class="event-time">
        <div class="event-start">${escapeHtml(event.start || '—')}</div>
        <div class="event-end">${escapeHtml(event.end || '')}</div>
      </div>
      <div>
        <div class="event-meta">
          <span class="event-code">${escapeHtml(event.courseCode)}</span>
          <span class="event-divider"></span>
          <span class="event-type">${escapeHtml((event.type || 'Övrigt').toUpperCase())}</span>
        </div>
        <h3>${escapeHtml(event.title)}</h3>
        <div class="event-location">${escapeHtml(event.location || 'Okänd plats')}</div>
        ${teachingGroup ? `<div class="event-group">${escapeHtml(teachingGroup)}</div>` : ''}
      </div>
    </article>
  `;
}

function dayGroupHtml({ name, dateLabel, items, isToday }) {
  const eventsHtml = items.length
    ? items.map(eventHtml).join('')
    : '<div class="empty-day">Ledig</div>';

  return `
    <section class="day-group ${isToday ? 'today' : ''}">
      <header class="day-header">
        <span class="day-name">${escapeHtml(name)}</span>
        <span class="day-date">${escapeHtml(dateLabel)}</span>
        <span class="day-count">${items.length ? `${items.length} st` : ''}</span>
      </header>
      ${eventsHtml}
    </section>
  `;
}

function renderWeekView() {
  if (!state.weekStart) {
    eventListEl.innerHTML = '<div class="empty-state">Inga scheman att visa.</div>';
    return;
  }

  const useGrid = state.view === 'grid' && state.deadlineMode !== 'only';
  eventListEl.classList.toggle('hidden', useGrid);
  gridViewEl.classList.toggle('hidden', !useGrid);
  gridTimeSummaryEl.classList.toggle('hidden', !useGrid);

  if (state.deadlineMode === 'only') {
    const deadlineEvents = sortEvents(state.events.filter((event) => isDeadlineEvent(event) && matchesFilters(event)), state.sortMode);
    const deadlineDates = [...new Set(deadlineEvents.map((event) => event.date))];

    weekRangeEl.textContent = 'Alla deadlines';
    weekSubEl.textContent = `${deadlineEvents.length} st`;

    const html = deadlineDates
      .map((date) => {
        const day = new Date(`${date}T00:00:00`);
        return dayGroupHtml({
          name: formatWeekday(date),
          dateLabel: formatDateKey(day),
          items: deadlineEvents.filter((event) => event.date === date),
          isToday: date === dateToKey(new Date())
        });
      })
      .join('');

    eventListEl.innerHTML = html || '<div class="empty-state">Inga deadlines.</div>';
    return;
  }

  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(state.weekStart, index));
  const filteredEvents = sortEvents(state.events.filter(matchesFilters), state.sortMode);
  const todayKey = dateToKey(new Date());

  weekRangeEl.textContent = `${formatDateKey(weekDates[0])} – ${formatDateKey(weekDates[6])}`;
  weekSubEl.textContent = `V. ${weekNumber(weekDates[3])}`;

  if (useGrid) {
    renderGridView(weekDates, filteredEvents, todayKey);
    return;
  }

  const html = weekDates
    .map((date) => {
      const key = dateToKey(date);
      return dayGroupHtml({
        name: formatWeekday(key),
        dateLabel: formatDateKey(date),
        items: filteredEvents.filter((event) => event.date === key),
        isToday: key === todayKey
      });
    })
    .join('');

  eventListEl.innerHTML = html;
}

function renderGridView(weekDates, events, todayKey) {
  const dayHeaders = weekDates
    .map((date, i) => {
      const key = dateToKey(date);
      return `<div class="grid-day-header ${key === todayKey ? 'today' : ''}" style="grid-column:${i + 2}">${escapeHtml(formatWeekday(key))} ${escapeHtml(formatDateKey(date))}</div>`;
    })
    .join('');

  const dayColumns = weekDates
    .map((date, i) => `<div class="grid-day-col" data-day-index="${i}" style="grid-column:${i + 2}; grid-row:2 / ${GRID_ROWS + 2}"></div>`)
    .join('');

  const hourLabels = [];
  for (let minute = GRID_START_MIN; minute < GRID_END_MIN; minute += 60) {
    const row = Math.round((minute - GRID_START_MIN) / GRID_SLOT_MIN) + 2;
    hourLabels.push(`<div class="grid-time-label" style="grid-row:${row} / span 4">${String(Math.floor(minute / 60)).padStart(2, '0')}:00</div>`);
  }

  const weekDateKeys = new Set(weekDates.map(dateToKey));
  const eventsInWeek = events.filter((event) => weekDateKeys.has(event.date));
  const customInWeek = state.customEvents.filter((event) => weekDateKeys.has(event.date));
  const allEvents = [...eventsInWeek, ...customInWeek];

  const eventBlocks = allEvents
    .map((event) => {
      const dayIndex = weekDates.findIndex((date) => dateToKey(date) === event.date);
      if (dayIndex === -1) return '';

      const startMin = minutesFromMidnight(event.start);
      const endMin = event.end ? minutesFromMidnight(event.end) : startMin + GRID_SLOT_MIN;
      if (endMin <= GRID_START_MIN || startMin >= GRID_END_MIN) return '';

      const clampedStart = Math.min(Math.max(startMin, GRID_START_MIN), GRID_END_MIN);
      const clampedEnd = Math.min(Math.max(endMin, GRID_START_MIN), GRID_END_MIN);
      const rowStart = Math.round((clampedStart - GRID_START_MIN) / GRID_SLOT_MIN) + 2;
      const rowEnd = Math.max(Math.round((clampedEnd - GRID_START_MIN) / GRID_SLOT_MIN) + 2, rowStart + 1);

      const isCustom = Boolean(event.custom);
      const isDimmed = !isCustom && state.dimmed.has(event.id);
      const isSelected = isCustom && event.id === state.selectedCustomId;
      const classes = ['grid-event', isDeadlineEvent(event) && 'deadline', isCustom && 'custom', isDimmed && 'dimmed', isSelected && 'selected']
        .filter(Boolean)
        .join(' ');
      const handles = isCustom
        ? '<div class="grid-event-handle top" data-edge="start"></div><div class="grid-event-handle bottom" data-edge="end"></div>'
        : '';
      const colorStyle = isCustom ? `background:${escapeHtml(event.color || CUSTOM_EVENT_DEFAULT_COLOR)};` : '';
      const editToolbar = isCustom
        ? `<div class="grid-event-edit"><input type="color" class="grid-event-color-input" value="${escapeHtml(event.color || CUSTOM_EVENT_DEFAULT_COLOR)}" title="Färg" /></div>`
        : '';
      const note = state.notes[event.id] || '';
      const noteBtn = `<button type="button" class="grid-event-note-btn ${note ? 'has-note' : ''}" title="${note ? 'Redigera anteckning' : 'Lägg till anteckning'}">🗒</button>`;
      const noteHtml = note ? `<div class="grid-event-note">${escapeHtml(note)}</div>` : '';
      const titleAttr = note ? `${event.title}\n\n${note}` : event.title;

      return `
        <div class="${classes}" data-event-id="${escapeHtml(event.id)}" data-custom="${isCustom}" data-day-index="${dayIndex}" style="grid-column:${dayIndex + 2}; grid-row:${rowStart} / ${rowEnd}; ${colorStyle}" title="${escapeHtml(titleAttr)}">
          ${handles}
          ${noteBtn}
          <div class="grid-event-time">${escapeHtml(event.start)}${event.end ? '–' + escapeHtml(event.end) : ''}</div>
          <div class="grid-event-title" ${isCustom ? `contenteditable="${isSelected}"` : ''}>${escapeHtml(event.title)}</div>
          <div class="grid-event-meta">${escapeHtml(isCustom ? 'Eget' : event.courseCode)}${event.location ? ' · ' + escapeHtml(event.location) : ''}</div>
          ${noteHtml}
          ${editToolbar}
        </div>`;
    })
    .join('');

  gridViewEl.style.setProperty('--grid-rows', String(GRID_ROWS + 2));
  gridViewEl.innerHTML = dayColumns + dayHeaders + hourLabels.join('') + eventBlocks;

  renderTimeSummary(eventsInWeek, customInWeek);
}

const IMPORTED_BLOCK_LABEL = 'Schemalagd undervisning';

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function renderTimeSummary(importedEvents, customEvents) {
  const minutesByTitle = new Map();

  importedEvents.forEach((event) => {
    const startMin = minutesFromMidnight(event.start);
    const endMin = minutesFromMidnight(event.end);
    const duration = endMin - startMin;
    if (duration <= 0) return;

    const covered = customEvents
      .filter((custom) => custom.date === event.date)
      .reduce((sum, custom) => sum + overlapMinutes(startMin, endMin, minutesFromMidnight(custom.start), minutesFromMidnight(custom.end)), 0);

    const countedMinutes = Math.max(0, duration - covered);
    if (countedMinutes <= 0) return;
    minutesByTitle.set(IMPORTED_BLOCK_LABEL, (minutesByTitle.get(IMPORTED_BLOCK_LABEL) || 0) + countedMinutes);
  });

  customEvents.forEach((event) => {
    const duration = minutesFromMidnight(event.end) - minutesFromMidnight(event.start);
    if (duration <= 0) return;
    minutesByTitle.set(event.title, (minutesByTitle.get(event.title) || 0) + duration);
  });

  const rows = [...minutesByTitle.entries()].sort((a, b) => a[0].localeCompare(b[0], 'sv'));

  gridTimeSummaryEl.innerHTML = rows.length
    ? rows.map(([title, minutes]) => `
        <div class="time-summary-row">
          <span class="time-summary-title">${escapeHtml(title)}</span>
          <span class="time-summary-value">${formatDuration(minutes)}</span>
        </div>
      `).join('')
    : '<div class="empty-state">Inga block denna vecka.</div>';
}

function formatDuration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} tim ${minutes} min` : `${hours} tim`;
}

function minutesFromMidnight(timeStr) {
  const [hours, minutes] = String(timeStr || '0:0').split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function minutesToTime(totalMinutes) {
  const snapped = Math.round(totalMinutes / GRID_SLOT_MIN) * GRID_SLOT_MIN;
  const hours = Math.floor(snapped / 60);
  const minutes = snapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function clampMin(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function weekNumber(date) {
  const jan = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date - jan) / 86400000 + jan.getDay() + 1) / 7);
}

function formatDateKey(date, options = { day: 'numeric', month: 'short' }) {
  return date.toLocaleDateString('sv-SE', options);
}

function formatWeekday(dateString) {
  const date = typeof dateString === 'string' ? new Date(`${dateString}T00:00:00`) : dateString;
  return date.toLocaleDateString('sv-SE', { weekday: 'short' }).replace('.', '');
}

function updateSummary() {
  totalEventsEl.textContent = String(state.events.length);
  totalCoursesEl.textContent = String(new Set(state.events.map((event) => event.courseName)).size);
  totalDeadlinesEl.textContent = String(state.events.filter(isDeadlineEvent).length);
}

function updatePanelStatus() {
  const search = searchInputEl.value.trim();
  panelStatusEl.textContent = [
    state.selectedCourse === 'Alla' ? null : state.selectedCourse.split(' ')[0],
    state.deadlineMode === 'only' ? 'Deadlines' : null,
    search ? `”${search}”` : null
  ].filter(Boolean).join(' · ');
}

function sortEvents(events, sortMode) {
  const sorted = [...events];

  if (sortMode === 'course') {
    return sorted.sort((a, b) => a.courseName.localeCompare(b.courseName, 'sv') || timestamp(a) - timestamp(b));
  }
  if (sortMode === 'type') {
    return sorted.sort((a, b) => (a.type || '').localeCompare(b.type || '', 'sv') || timestamp(a) - timestamp(b));
  }
  return sorted.sort((a, b) => timestamp(a) - timestamp(b));
}

function isDeadlineEvent(event) {
  const combined = `${event.title || ''} ${event.type || ''}`.toUpperCase();
  return combined.includes('DEADLINE') || event.type?.toUpperCase() === 'DEADLINE';
}

function isPastEvent(event) {
  return timestamp(event) < Date.now();
}

function startOfWeek(date) {
  const localDate = new Date(date);
  const day = localDate.getDay();
  localDate.setDate(localDate.getDate() + (day === 0 ? -6 : 1 - day));
  localDate.setHours(0, 0, 0, 0);
  return localDate;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateToKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

searchInputEl.addEventListener('input', () => {
  renderWeekView();
  updatePanelStatus();
});

sortSegEl.querySelectorAll('.seg-opt').forEach((button) => {
  button.addEventListener('click', () => {
    state.sortMode = button.dataset.sort;
    sortSegEl.querySelectorAll('.seg-opt').forEach((opt) => opt.classList.toggle('active', opt === button));
    renderWeekView();
  });
});

deadlineToggleEl.addEventListener('click', () => {
  state.deadlineMode = state.deadlineMode === 'only' ? 'all' : 'only';
  deadlineToggleEl.classList.toggle('active', state.deadlineMode === 'only');
  deadlineToggleEl.setAttribute('aria-pressed', String(state.deadlineMode === 'only'));
  renderWeekView();
  updatePanelStatus();
});

togglePanelEl.addEventListener('click', () => {
  state.panelOpen = !state.panelOpen;
  filterPanelEl.classList.toggle('hidden', !state.panelOpen);
  togglePanelEl.setAttribute('aria-expanded', String(state.panelOpen));
  panelCaretEl.textContent = state.panelOpen ? '×' : '+';
});

gridToggleEl.addEventListener('click', () => {
  state.view = state.view === 'grid' ? 'list' : 'grid';
  gridToggleEl.classList.toggle('active', state.view === 'grid');
  gridToggleEl.setAttribute('aria-pressed', String(state.view === 'grid'));
  appShellEl.classList.toggle('wide-mode', state.view === 'grid');
  renderWeekView();
});

prevWeekButtonEl.addEventListener('click', () => {
  state.weekStart = addDays(state.weekStart, -7);
  renderWeekView();
});

nextWeekButtonEl.addEventListener('click', () => {
  state.weekStart = addDays(state.weekStart, 7);
  renderWeekView();
});

gridViewEl.addEventListener('dblclick', (e) => {
  if (e.target.closest('.grid-event-title') || e.target.closest('.grid-event-edit') || e.target.closest('.grid-event-note-btn')) return;

  const eventBlock = e.target.closest('.grid-event');
  if (eventBlock) {
    if (eventBlock.dataset.custom === 'true') {
      const id = eventBlock.dataset.eventId;
      state.customEvents = state.customEvents.filter((ev) => ev.id !== id);
      if (state.selectedCustomId === id) state.selectedCustomId = null;
      saveCustomEvents();
      renderWeekView();
    }
    return;
  }

  const col = e.target.closest('.grid-day-col');
  if (!col) return;

  const dayIndex = Number(col.dataset.dayIndex);
  const rect = col.getBoundingClientRect();
  const slot = Math.floor((e.clientY - rect.top) / GRID_SLOT_PX);
  const startMin = clampMin(GRID_START_MIN + slot * GRID_SLOT_MIN, GRID_START_MIN, GRID_END_MIN - GRID_SLOT_MIN);
  const endMin = clampMin(startMin + 60, startMin + GRID_SLOT_MIN, GRID_END_MIN);

  const title = prompt('Namn på aktivitet:', 'Ny aktivitet');
  if (title === null) return;

  state.customEvents.push({
    id: `custom-${Date.now()}`,
    date: dateToKey(addDays(state.weekStart, dayIndex)),
    start: minutesToTime(startMin),
    end: minutesToTime(endMin),
    title: title.trim() || 'Ny aktivitet',
    courseCode: '',
    location: '',
    type: '',
    color: CUSTOM_EVENT_DEFAULT_COLOR,
    custom: true
  });
  saveCustomEvents();
  renderWeekView();
});

let suppressNextClick = false;

gridViewEl.addEventListener('click', (e) => {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  if (e.target.closest('.grid-event-handle') || e.target.closest('.grid-event-edit')) return;

  const noteBtn = e.target.closest('.grid-event-note-btn');
  if (noteBtn) {
    const eventEl = noteBtn.closest('.grid-event');
    const id = eventEl.dataset.eventId;
    const existing = state.notes[id] || '';
    const value = prompt('Anteckning:', existing);
    if (value === null) return;

    if (value.trim()) state.notes[id] = value.trim();
    else delete state.notes[id];
    saveNotes();
    renderWeekView();
    return;
  }

  const eventBlock = e.target.closest('.grid-event');

  if (eventBlock && eventBlock.dataset.custom === 'true') {
    selectCustomEvent(eventBlock.dataset.eventId);
    return;
  }

  if (eventBlock) {
    const id = eventBlock.dataset.eventId;
    state.dimmed.has(id) ? state.dimmed.delete(id) : state.dimmed.add(id);
    saveDimmed();
    eventBlock.classList.toggle('dimmed');
    return;
  }

  if (state.selectedCustomId) {
    state.selectedCustomId = null;
    renderWeekView();
  }
});

function selectCustomEvent(id) {
  if (state.selectedCustomId === id) return;
  state.selectedCustomId = id;
  renderWeekView();
}

gridViewEl.addEventListener('focusout', (e) => {
  const titleEl = e.target.closest('.grid-event-title');
  if (!titleEl) return;
  const eventEl = titleEl.closest('.grid-event.custom');
  if (!eventEl) return;

  const customEvent = state.customEvents.find((ev) => ev.id === eventEl.dataset.eventId);
  if (!customEvent) return;

  const newTitle = titleEl.textContent.trim() || 'Namnlös aktivitet';
  titleEl.textContent = newTitle;
  if (newTitle !== customEvent.title) {
    customEvent.title = newTitle;
    saveCustomEvents();
  }
});

gridViewEl.addEventListener('input', (e) => {
  const colorInput = e.target.closest('.grid-event-color-input');
  if (!colorInput) return;
  const eventEl = colorInput.closest('.grid-event.custom');
  const customEvent = state.customEvents.find((ev) => ev.id === eventEl.dataset.eventId);
  if (!customEvent) return;

  customEvent.color = colorInput.value;
  eventEl.style.background = colorInput.value;
  saveCustomEvents();
});

document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'd') return;
  if (!state.selectedCustomId) return;

  e.preventDefault();
  const original = state.customEvents.find((ev) => ev.id === state.selectedCustomId);
  if (!original) return;

  const copy = {
    ...original,
    id: `custom-${Date.now()}`,
    date: dateToKey(addDays(new Date(`${original.date}T00:00:00`), 1))
  };
  state.customEvents.push(copy);
  state.selectedCustomId = copy.id;
  saveCustomEvents();
  renderWeekView();
});

gridViewEl.addEventListener('mousedown', (e) => {
  const handle = e.target.closest('.grid-event-handle');
  if (handle) {
    startResize(e, handle);
    return;
  }

  if (e.target.closest('.grid-event-title') || e.target.closest('.grid-event-edit') || e.target.closest('.grid-event-note-btn')) return;

  const eventEl = e.target.closest('.grid-event.custom');
  if (eventEl) startMove(e, eventEl);
});

function startResize(e, handle) {
  e.preventDefault();

  const eventEl = handle.closest('.grid-event');
  const customEvent = state.customEvents.find((ev) => ev.id === eventEl.dataset.eventId);
  if (!customEvent) return;

  const edge = handle.dataset.edge;
  const startY = e.clientY;
  const originalStartMin = minutesFromMidnight(customEvent.start);
  const originalEndMin = minutesFromMidnight(customEvent.end);

  function onMove(moveEvent) {
    const deltaMin = Math.round((moveEvent.clientY - startY) / GRID_SLOT_PX) * GRID_SLOT_MIN;

    if (edge === 'start') {
      customEvent.start = minutesToTime(clampMin(originalStartMin + deltaMin, GRID_START_MIN, originalEndMin - GRID_SLOT_MIN));
    } else {
      customEvent.end = minutesToTime(clampMin(originalEndMin + deltaMin, originalStartMin + GRID_SLOT_MIN, GRID_END_MIN));
    }

    const startMin = minutesFromMidnight(customEvent.start);
    const endMin = minutesFromMidnight(customEvent.end);
    const rowStart = Math.round((startMin - GRID_START_MIN) / GRID_SLOT_MIN) + 2;
    const rowEnd = Math.round((endMin - GRID_START_MIN) / GRID_SLOT_MIN) + 2;
    eventEl.style.gridRow = `${rowStart} / ${rowEnd}`;
    eventEl.querySelector('.grid-event-time').textContent = `${customEvent.start}–${customEvent.end}`;
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    saveCustomEvents();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function startMove(e, eventEl) {
  e.preventDefault();

  const customEvent = state.customEvents.find((ev) => ev.id === eventEl.dataset.eventId);
  if (!customEvent) return;

  const dayCols = [...gridViewEl.querySelectorAll('.grid-day-col')].map((el) => ({
    dayIndex: Number(el.dataset.dayIndex),
    rect: el.getBoundingClientRect()
  }));

  const startY = e.clientY;
  const originalDayIndex = Number(eventEl.dataset.dayIndex);
  const originalStartMin = minutesFromMidnight(customEvent.start);
  const duration = minutesFromMidnight(customEvent.end) - originalStartMin;
  let moved = false;

  function onMove(moveEvent) {
    const deltaMin = Math.round((moveEvent.clientY - startY) / GRID_SLOT_PX) * GRID_SLOT_MIN;
    const newStart = clampMin(originalStartMin + deltaMin, GRID_START_MIN, GRID_END_MIN - duration);
    const newEnd = newStart + duration;
    const col = dayCols.find((c) => moveEvent.clientX >= c.rect.left && moveEvent.clientX < c.rect.right);
    const dayIndex = col ? col.dayIndex : originalDayIndex;
    if (newStart !== originalStartMin || dayIndex !== originalDayIndex) moved = true;

    customEvent.start = minutesToTime(newStart);
    customEvent.end = minutesToTime(newEnd);
    customEvent.date = dateToKey(addDays(state.weekStart, dayIndex));

    const rowStart = Math.round((newStart - GRID_START_MIN) / GRID_SLOT_MIN) + 2;
    const rowEnd = Math.round((newEnd - GRID_START_MIN) / GRID_SLOT_MIN) + 2;
    eventEl.style.gridRow = `${rowStart} / ${rowEnd}`;
    eventEl.style.gridColumn = String(dayIndex + 2);
    eventEl.dataset.dayIndex = String(dayIndex);
    eventEl.querySelector('.grid-event-time').textContent = `${customEvent.start}–${customEvent.end}`;
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (moved) {
      saveCustomEvents();
      suppressNextClick = true;
    }
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

loadSchedule();
