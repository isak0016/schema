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

const state = {
  events: [],
  selectedCourse: 'Alla',
  sortMode: 'date',
  deadlineMode: 'all',
  weekStart: null,
  panelOpen: false
};

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
        program: cleanValue(entry.Program),
        group: cleanValue(entry['Kurs,Grupp'])
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
    event.program
  ].join(' ').toLowerCase().includes(searchText);

  return matchesCourse && matchesDeadline && matchesSearch;
}

function eventHtml(event) {
  const isDeadline = isDeadlineEvent(event);
  const past = isPastEvent(event);
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

prevWeekButtonEl.addEventListener('click', () => {
  state.weekStart = addDays(state.weekStart, -7);
  renderWeekView();
});

nextWeekButtonEl.addEventListener('click', () => {
  state.weekStart = addDays(state.weekStart, 7);
  renderWeekView();
});

loadSchedule();
