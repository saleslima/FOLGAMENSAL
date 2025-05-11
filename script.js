import { initializeApp } from "firebase/app";
import { getDatabase, ref, query, orderByChild, equalTo, onValue, set, get, remove } from "firebase/database";
import { equipes, ehDiaDeTrabalho, formatDateYMD } from "./schedule-generator.js";
import { isHoliday, isWeekend, getHolidayName } from "./holidays.js";

// Firebase configuration from the user
const firebaseConfig = {
  apiKey: "AIzaSyA-U3nYN7M_NpW7bvaqE9BT_--o7RfBcqY",
  authDomain: "controle-gastos-9539d.firebaseapp.com",
  databaseURL: "https://controle-gastos-9539d-default-rtdb.firebaseio.com",
  projectId: "controle-gastos-9539d",
  storageBucket: "controle-gastos-9539d.firebasestorage.app",
  messagingSenderId: "538009752360",
  appId: "1:538009752360:web:5be290d4183fc5e886361d"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

const teams = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO'];
const teamSelectionDiv = document.getElementById('teamSelection');
const userListUl = document.getElementById('userList');
const userListTitle = document.getElementById('userListTitle');
const generatedScheduleTitle = document.getElementById('generatedScheduleTitle');
const generatedScheduleListUl = document.getElementById('generatedScheduleList');
const scheduleInfoSpan = document.getElementById('scheduleInfo');
const exceptionButton = document.getElementById('exceptionButton');
const exceptionModal = document.getElementById('exceptionModal');
const closeModal = document.getElementById('closeModal');
const exceptionDateSelect = document.getElementById('exceptionDate');
const vacancyActionSelect = document.getElementById('vacancyAction');
const vacancyCountInput = document.getElementById('vacancyCount');
const applyExceptionButton = document.getElementById('applyException');

// New DOM elements for scheduling
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const maxWeekdaysInput = document.getElementById('maxWeekdays');
const maxWeekendsInput = document.getElementById('maxWeekends');
const calendarContainerDiv = document.getElementById('calendarContainer');
const generateScheduleButton = document.getElementById('generateScheduleButton');
const saveScheduleButton = document.getElementById('saveScheduleButton');
const resetScheduleButton = document.getElementById('resetScheduleButton');
const pdfScheduleButton = document.getElementById('pdfScheduleButton');
const toggleScheduleSectionButton = document.getElementById('toggleScheduleSection');
const scheduleInputContainer = document.getElementById('scheduleInputContainer');
const useAutoScheduleCheckbox = document.getElementById('useAutoSchedule');
const newScheduleButton = document.getElementById('newScheduleButton');

const viewSavedSchedulesButton = document.getElementById('viewSavedSchedulesButton');

// Add to Home Screen functionality
let deferredPrompt;
const addToHomeButton = document.getElementById('addToHomeButton');

// Hide button initially
addToHomeButton.style.display = 'none';

// Detect when PWA install is available
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later
    deferredPrompt = e;
    // Show the button
    addToHomeButton.style.display = 'flex';
});

// Add click handler for the button
addToHomeButton.addEventListener('click', async () => {
    if (!deferredPrompt) {
        // If app is already installed or not installable, offer manual instructions
        alert('Para adicionar à tela inicial: \n\n' +
              'iOS: Use o botão "Compartilhar" e depois "Adicionar à Tela de Início"\n\n' +
              'Android: Use o menu do navegador e "Adicionar à Tela Inicial"');
        return;
    }
    
    // Show the install prompt
    deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    const choiceResult = await deferredPrompt.userChoice;
    
    // Reset the deferred prompt variable
    deferredPrompt = null;
    // Hide the button
    addToHomeButton.style.display = 'none';
});

// Hide button when app is installed
window.addEventListener('appinstalled', (evt) => {
    addToHomeButton.style.display = 'none';
});

// State variables
let selectedScaleDays = [];
let currentTeamUsers = [];
let currentUserIndex = 0;
let scheduleVacancies = {};
let scheduleAssignments = {};
let currentSelectedTeam = null;
let scheduleExpanded = true; // Default state is expanded
let reassignmentQueue = []; // Stores users who need to be reassigned due to vacancy reduction

// Function to display team buttons
function displayTeamButtons() {
    teams.forEach(team => {
        const button = document.createElement('button');
        button.textContent = team;
        button.classList.add('team-button');
        button.addEventListener('click', () => selectTeam(team, button));
        teamSelectionDiv.appendChild(button);
    });
}

// Function to fetch and display users for a selected team
function selectTeam(team, clickedButton) {
    document.querySelectorAll('.team-button').forEach(btn => {
        btn.classList.remove('active');
    });
    clickedButton.classList.add('active');

    currentSelectedTeam = team;
    userListTitle.textContent = `Usuários da Equipe: ${team}`;
    userListUl.innerHTML = '<li>Carregando...</li>';
    currentTeamUsers = [];
    currentUserIndex = 0;
    removeUserHighlight();
    resetScheduleUI(); // Reset generated schedule UI state

    // After resetting the UI, regenerate the calendar with team's schedule
    generateCalendar();

    const usersRef = ref(database, 'usuarios');
    const teamQuery = query(usersRef, orderByChild('equipe'), equalTo(team));

    onValue(teamQuery, (snapshot) => {
        userListUl.innerHTML = '';
        currentTeamUsers = [];

        if (snapshot.exists()) {
            const users = snapshot.val();
            const userKeys = Object.keys(users);
            const tempUsers = [];
            userKeys.forEach(key => {
                const user = users[key];
                if (user.postoGraduacao && user.nomeGuerra && user.senha) {
                    tempUsers.push({
                        ...user,
                        displayName: `${user.postoGraduacao} ${user.nomeGuerra}`
                    });
                }
            });

            // Define the rank order mapping (rank precedence)
            const rankOrder = {
                'CORONEL': 1,
                'TENENTE-CORONEL': 2,
                'MAJOR': 3,
                'CAPITÃO': 4,
                'CAPITAO': 4,
                '1º TENENTE': 5,
                '1 TENENTE': 5,
                '2º TENENTE': 6,
                '2 TENENTE': 6,
                'ASPIRANTE': 7,
                'SUBTENENTE': 8,
                '1º SARGENTO': 9,
                '1 SARGENTO': 9,
                '2º SARGENTO': 10,
                '2 SARGENTO': 10,
                '3º SARGENTO': 11,
                '3 SARGENTO': 11,
                'CABO': 12,
                'SOLDADO': 13
            };
            
            // Sort users by rank (posto/graduação) and then by promotion date if ranks are equal
            tempUsers.sort((a, b) => {
                // Convert to uppercase for case-insensitive comparison
                const rankA = a.postoGraduacao.toUpperCase();
                const rankB = b.postoGraduacao.toUpperCase();
                
                // Get the numerical rank order value (lower number = higher rank)
                const rankOrderA = rankOrder[rankA] || 999; // Default to lowest rank if not found
                const rankOrderB = rankOrder[rankB] || 999;
                
                // If ranks are different, sort by rank
                if (rankOrderA !== rankOrderB) {
                    return rankOrderA - rankOrderB;
                }
                
                // If ranks are the same, sort by promotion date (earlier date = higher precedence)
                if (a.dataPromocao && b.dataPromocao) {
                    return new Date(a.dataPromocao) - new Date(b.dataPromocao);
                } else if (a.dataPromocao) {
                    return -1; // A has promotion date, B doesn't
                } else if (b.dataPromocao) {
                    return 1;  // B has promotion date, A doesn't
                }
                
                // If no promotion dates or they're equal, fallback to name
                return a.displayName.localeCompare(b.displayName);
            });
            
            currentTeamUsers = tempUsers;

            if (currentTeamUsers.length === 0) {
                userListUl.innerHTML = '<li>Nenhum usuário com posto, nome de guerra e senha encontrados para esta equipe.</li>';
                disableScheduleButtons();
                return;
            }

            currentTeamUsers.forEach((user, index) => {
                const listItem = document.createElement('li');
                listItem.textContent = user.displayName;
                listItem.dataset.userIndex = index;
                userListUl.appendChild(listItem);
            });

            // After loading users, attempt to load saved schedule for this team
            loadSchedule(team);
            enableScheduleButtons();

            updateScheduleInfo(); // Update the info display when a team is selected

        } else {
            userListUl.innerHTML = '<li>Nenhum usuário encontrado para esta equipe.</li>';
            disableScheduleButtons();
            resetScheduleUI(); // Reset schedule state if no users are found
            generateCalendar(); // Ensure calendar reflects current state (likely empty selected days)
        }
    }, (error) => {
        console.error("Erro ao buscar usuários:", error);
        userListUl.innerHTML = `<li>Erro ao carregar usuários: ${error.message}</li>`;
        disableScheduleButtons();
        resetScheduleUI(); // Reset schedule state on error
        generateCalendar(); // Ensure calendar reflects current state
    });
}

function enableScheduleButtons() {
    generateScheduleButton.disabled = false;
    saveScheduleButton.disabled = false;
    resetScheduleButton.disabled = false;
}

function disableScheduleButtons() {
    generateScheduleButton.disabled = true;
    saveScheduleButton.disabled = true;
    resetScheduleButton.disabled = true;
}

// --- Schedule Saving and Loading ---

async function saveSchedule() {
    if (!currentSelectedTeam) {
        alert("Selecione uma equipe primeiro.");
        return;
    }
    // Ensure there is a generated schedule to save
    if (selectedScaleDays.length === 0 || Object.keys(scheduleAssignments).length === 0) {
        alert("Gere a escala primeiro antes de salvar.");
        return;
    }

    const scheduleData = {
        assignments: scheduleAssignments,
        vacancies: scheduleVacancies,
        selectedDays: selectedScaleDays,
        currentUserIndex: currentUserIndex,
        maxWeekdays: parseInt(maxWeekdaysInput.value, 10) || 0,
        maxWeekends: parseInt(maxWeekendsInput.value, 10) || 0,
        expanded: scheduleExpanded, // Save the expanded state
        savedDate: new Date().toISOString() // Add timestamp when saved
    };

    try {
        // Check if we should save as a completed schedule
        const isCompleted = currentUserIndex >= currentTeamUsers.length;
        
        if (isCompleted) {
            // This is a completed schedule - save to archive
            await saveScheduleToArchive(scheduleData);
            console.log(`Escala completa para ${currentSelectedTeam} arquivada com sucesso!`);
        }
        
        // Always save as current schedule
        await set(ref(database, `schedules/${currentSelectedTeam}`), scheduleData);
        console.log(`Escala para ${currentSelectedTeam} salva com sucesso!`);
        alert("Escala salva com sucesso!");
    } catch (error) {
        console.error("Erro ao salvar escala:", error);
        alert(`Erro ao salvar escala: ${error.message}`);
    }
}

// New function to save completed schedule to archive
async function saveScheduleToArchive(scheduleData) {
    // Get the date range for naming
    const startDate = new Date(startDateInput.value);
    const endDate = new Date(endDateInput.value);
    const scheduleName = `${formatDateForFilename(startDate)}A${formatDateForFilename(endDate)}_${currentSelectedTeam.toUpperCase()}`;
    
    // Reference to the team's schedule archive
    const archiveRef = ref(database, `scheduleArchive/${currentSelectedTeam}`);
    
    try {
        // Get current archive
        const snapshot = await get(archiveRef);
        let archive = {};
        
        if (snapshot.exists()) {
            archive = snapshot.val();
        }
        
        // Add new schedule with timestamp
        scheduleData.scheduleName = scheduleName;
        scheduleData.archivedAt = new Date().toISOString();
        
        // Convert archive to array, add new item, sort by archived date
        let archiveArray = Object.entries(archive).map(([key, value]) => ({ key, ...value }));
        archiveArray.push({ key: scheduleName, ...scheduleData });
        
        // Sort by archived date (newest first)
        archiveArray.sort((a, b) => new Date(b.archivedAt) - new Date(a.archivedAt));
        
        // Keep only the 10 most recent
        if (archiveArray.length > 10) {
            console.log(`Removing oldest schedule: ${archiveArray[10].scheduleName}`);
            archiveArray = archiveArray.slice(0, 10);
        }
        
        // Convert back to object
        const newArchive = {};
        archiveArray.forEach(item => {
            const { key, ...data } = item;
            newArchive[key] = data;
        });
        
        // Save updated archive
        await set(archiveRef, newArchive);
    } catch (error) {
        console.error("Error saving to archive:", error);
        throw error;
    }
}

// Format date for filename using the specific format
function formatDateForFilename(dateObj) {
    const day = dateObj.getDate().toString().padStart(2, '0');
    // Get first 3 letters of month name in Portuguese (uppercase)
    const monthNames = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 
                        'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
    const month = monthNames[dateObj.getMonth()];
    // Get last 2 digits of year
    const year = dateObj.getFullYear().toString().slice(-2);
    return `${day}${month}${year}`;
}

async function loadSchedule(team) {
    if (!team) return;

    try {
        get(ref(database, `schedules/${team}`)).then((snapshot) => {
            // Always reset the generated schedule UI display and assignment state before loading
            resetScheduleUI(); // This clears assignments, vacancies, user index, and generated list display

            if (snapshot.exists()) {
                const savedData = snapshot.val();
                console.log(`Escala salva para ${team} encontrada. Tentando carregar...`, savedData);

                // Load the saved state
                scheduleAssignments = savedData.assignments || {};
                scheduleVacancies = savedData.vacancies || {};
                selectedScaleDays = savedData.selectedDays || [];
                currentUserIndex = savedData.currentUserIndex || 0;
                
                // Update max inputs if they were saved
                if (savedData.maxWeekdays !== undefined) maxWeekdaysInput.value = savedData.maxWeekdays;
                if (savedData.maxWeekends !== undefined) maxWeekendsInput.value = savedData.maxWeekends;
                
                // Set date fields if available in the saved schedule
                if (selectedScaleDays && selectedScaleDays.length > 0) {
                    // Sort the days to get first and last
                    const sortedDays = [...selectedScaleDays].sort();
                    startDateInput.value = sortedDays[0];
                    endDateInput.value = sortedDays[sortedDays.length - 1];
                }
                
                // Set expanded state from saved data
                scheduleExpanded = savedData.expanded !== undefined ? savedData.expanded : true;
                updateSectionVisibility(); // Update UI based on expanded state
                
                // Generate calendar to reflect selected days
                generateCalendar();
                
                // Display the saved schedule
                displaySavedSchedule();
                highlightCurrentUser();
                
                // Update schedule info after loading saved data
                updateScheduleInfo();

            } else {
                console.log(`Nenhuma escala salva encontrada para a equipe ${team}.`);
                resetScheduleUI(); // Reset schedule state if no saved schedule is found
                generateCalendar(); // Ensure calendar reflects current state (likely empty selected days)
            }
        }).catch(error => {
            console.error("Erro ao carregar escala:", error);
            alert(`Erro ao carregar escala: ${error.message}`);
            resetScheduleUI(); // Reset schedule state on error
            generateCalendar(); // Ensure calendar reflects current state
        });
    } catch (error) {
        console.error("Erro ao carregar escala:", error);
        alert(`Erro ao carregar escala: ${error.message}`);
        resetScheduleUI(); // Reset schedule state on error
        generateCalendar(); // Ensure calendar reflects current state
    }
}

// New function to display saved schedule
function displaySavedSchedule() {
    generatedScheduleListUl.innerHTML = '';
    
    if (selectedScaleDays.length === 0) {
        generatedScheduleListUl.innerHTML = '';
        generatedScheduleTitle.style.display = 'none';
        return;
    }
    
    selectedScaleDays.sort((a, b) => new Date(a) - new Date(b));
    
    selectedScaleDays.forEach(dateStr => {
        const listItem = document.createElement('li');
        listItem.dataset.date = dateStr;
        
        // Add holiday or weekend highlighting
        const date = new Date(dateStr + 'T00:00:00');
        if (isWeekend(date) || isHoliday(date)) {
            listItem.classList.add('holiday-date');
            
            // Add tooltip for holidays
            const holidayName = getHolidayName(date);
            if (holidayName) {
                listItem.title = holidayName;
            }
        }
        
        const vacancies = scheduleVacancies[dateStr] || 0;
        
        if (vacancies <= 0) {
            listItem.classList.add('full');
            listItem.style.pointerEvents = 'none';
        } else {
            listItem.addEventListener('click', () => handleScheduleDayClick(dateStr, listItem));
        }
        
        updateScheduleItemText(listItem, dateStr);
        generatedScheduleListUl.appendChild(listItem);
    });
    
    generatedScheduleTitle.style.display = 'block';
}

async function resetSchedule() {
    if (!currentSelectedTeam) {
        alert("Selecione uma equipe primeiro.");
        return;
    }

    if (!confirm(`Tem certeza que deseja resetar a escala para a equipe ${currentSelectedTeam}? Isso apagará a escala salva.`)) {
        return; 
    }

    try {
        await remove(ref(database, `schedules/${currentSelectedTeam}`));
        console.log(`Escala para ${currentSelectedTeam} resetada no Firebase.`);

        resetScheduleUI();
        generateCalendar(); 
        alert("Escala resetada com sucesso!");

    } catch (error) {
        console.error("Erro ao resetar escala:", error);
        alert(`Erro ao resetar escala: ${error.message}`);
    }
}

// Reset schedule state variables and UI display
function resetScheduleUI() {
    selectedScaleDays = [];
    scheduleAssignments = {};
    scheduleVacancies = {};
    currentUserIndex = 0;
    generatedScheduleListUl.innerHTML = '';
    generatedScheduleTitle.style.display = 'none';
    removeUserHighlight(); 
    disableScheduleClicks(); 
}

// --- Calendar and Schedule Generation Logic ---

function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

function getStartDayOfWeek(year, month) {
    return new Date(year, month, 1).getDay();
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function generateCalendar() {
    const startDateStr = startDateInput.value;
    const endDateStr = endDateInput.value;

    calendarContainerDiv.innerHTML = ''; 

    if (!startDateStr || !endDateStr) {
        calendarContainerDiv.innerHTML = '<p>Selecione a Data Inicial e Data Final para exibir o calendário.</p>';
        resetScheduleUI();
        return;
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    const startLoopDate = new Date(startDateStr);
    const endLoopDate = new Date(endDateStr);

    if (startLoopDate > endLoopDate) {
        calendarContainerDiv.innerHTML = '<p>A Data Inicial deve ser antes ou igual à Data Final.</p>';
        resetScheduleUI(); 
        return;
    }

    let currentDate = new Date(startLoopDate.getFullYear(), startLoopDate.getMonth(), 1);

    while (currentDate <= endLoopDate) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth(); 
        const monthName = new Date(year, month).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
        const daysInMonth = getDaysInMonth(year, month);
        const startDayOfWeek = getStartDayOfWeek(year, month); 

        const monthContainer = document.createElement('div');
        monthContainer.classList.add('month-container');

        const monthHeader = document.createElement('div');
        monthHeader.classList.add('month-header');
        monthHeader.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1); 

        const daysOfWeekHeader = document.createElement('div');
        daysOfWeekHeader.classList.add('days-of-week');
        ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].forEach(day => {
            const daySpan = document.createElement('span');
            daySpan.textContent = day;
            daysOfWeekHeader.appendChild(daySpan);
        });

        const daysGrid = document.createElement('div');
        daysGrid.classList.add('days-grid');

        for (let i = 0; i < startDayOfWeek; i++) {
            const emptyDay = document.createElement('div');
            emptyDay.classList.add('day', 'disabled');
            daysGrid.appendChild(emptyDay);
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const fullDate = new Date(year, month, day);
            const formattedDate = formatDate(fullDate);

            const dayElement = document.createElement('div');
            dayElement.classList.add('day');
            dayElement.textContent = day;
            dayElement.dataset.date = formattedDate; 

            const dateOnly = new Date(formattedDate + 'T00:00:00'); 
            if (dateOnly < new Date(startDateStr + 'T00:00:00') || dateOnly > new Date(endDateStr + 'T00:00:00')) {
                dayElement.classList.add('disabled');
                dayElement.style.pointerEvents = 'none'; 
            } else {
                dayElement.addEventListener('click', () => handleDayClick(formattedDate, dayElement));
                
                // Highlight days based on team schedule
                if (currentSelectedTeam && ehDiaDeTrabalho(currentSelectedTeam, dateOnly)) {
                    dayElement.classList.add('selected');
                    
                    // Add holiday or weekend highlighting
                    if (isHoliday(dateOnly) || isWeekend(dateOnly)) {
                        dayElement.classList.add('holiday');
                        
                        // Add tooltip for holidays
                        const holidayName = getHolidayName(dateOnly);
                        if (holidayName) {
                            dayElement.title = holidayName;
                        }
                    }
                    
                    if (!selectedScaleDays.includes(formattedDate)) {
                        selectedScaleDays.push(formattedDate);
                    }
                } else if (selectedScaleDays.includes(formattedDate)) {
                    dayElement.classList.add('selected');
                    
                    // Add holiday or weekend highlighting for manually selected days too
                    if (isHoliday(dateOnly) || isWeekend(dateOnly)) {
                        dayElement.classList.add('holiday');
                        
                        // Add tooltip for holidays
                        const holidayName = getHolidayName(dateOnly);
                        if (holidayName) {
                            dayElement.title = holidayName;
                        }
                    }
                }
            }

            daysGrid.appendChild(dayElement);
        }

        monthContainer.appendChild(monthHeader);
        monthContainer.appendChild(daysOfWeekHeader);
        monthContainer.appendChild(daysGrid);
        calendarContainerDiv.appendChild(monthContainer);

        currentDate = new Date(year, month + 1, 1);
    }
    if (calendarContainerDiv.innerHTML === '') {
        calendarContainerDiv.innerHTML = '<p>Nenhum mês no intervalo de datas selecionado.</p>';
    }
}

function handleDayClick(date, element) {
    if (element.classList.contains('disabled')) {
        return;
    }

    const index = selectedScaleDays.indexOf(date);
    if (index === -1) {
        selectedScaleDays.push(date);
        element.classList.add('selected');
    } else {
        selectedScaleDays.splice(index, 1);
        element.classList.remove('selected');
    }
    selectedScaleDays.sort();

    // Removed the call to resetScheduleUI() that was preventing days from being accumulated
}

function generateSchedule() {
    // Clear previous schedule but keep selectedScaleDays
    generatedScheduleListUl.innerHTML = '';
    scheduleVacancies = {};
    scheduleAssignments = {};
    
    if (selectedScaleDays.length === 0) {
        generatedScheduleListUl.innerHTML = '<li>Selecione dias no calendário para gerar a escala.</li>';
        removeUserHighlight();
        return;
    }
    
    if (currentTeamUsers.length === 0) {
        generatedScheduleListUl.innerHTML = '<li>Selecione uma equipe com usuários para gerar a escala.</li>';
        removeUserHighlight();
        return;
    }

    const maxWeekdays = parseInt(maxWeekdaysInput.value, 10) || 0;
    const maxWeekends = parseInt(maxWeekendsInput.value, 10) || 0;

    if (maxWeekdays <= 0 && maxWeekends <= 0) {
        generatedScheduleListUl.innerHTML = '<li>Defina valores maiores que zero para Máx Dias Semana ou Máx Dias Fim Semana.</li>';
        removeUserHighlight();
        return;
    }

    selectedScaleDays.sort((a, b) => new Date(a) - new Date(b));

    selectedScaleDays.forEach(dateStr => {
        const date = new Date(dateStr + 'T00:00:00');
        const dayOfWeek = date.getUTCDay(); 

        const isWeekendOrHoliday = isWeekend(date) || isHoliday(date);
        const vacancyLimit = isWeekendOrHoliday ? maxWeekends : maxWeekdays;

        scheduleVacancies[dateStr] = vacancyLimit;
        scheduleAssignments[dateStr] = scheduleAssignments[dateStr] || [];

        const listItem = document.createElement('li');
        listItem.dataset.date = dateStr; 
        
        // Add holiday or weekend highlighting class
        if (isWeekendOrHoliday) {
            listItem.classList.add('holiday-date');
            
            // Add tooltip for holidays
            const holidayName = getHolidayName(date);
            if (holidayName) {
                listItem.title = holidayName;
            }
        }

        if (vacancyLimit <= 0) {
            listItem.classList.add('full'); 
            listItem.style.pointerEvents = 'none'; 
        } else {
            listItem.addEventListener('click', () => handleScheduleDayClick(dateStr, listItem));
        }
        
        updateScheduleItemText(listItem, dateStr); 
        generatedScheduleListUl.appendChild(listItem);
    });

    generatedScheduleTitle.style.display = 'block';
    
    // Reset to first user and highlight them
    currentUserIndex = 0;
    highlightCurrentUser();

    updateScheduleInfo(); // Update the schedule info display
    
    // Automatically save the generated schedule
    saveSchedule().catch(error => {
        console.error("Erro ao salvar automaticamente após gerar escala:", error);
    });
}

function handleScheduleDayClick(dateStr, element) {
    if (currentTeamUsers.length === 0 || currentUserIndex >= currentTeamUsers.length) {
        console.log("Nenhum usuário ativo para selecionar.");
        return; 
    }
    if (element.classList.contains('full') || element.classList.contains('disabled')) {
        console.log("Esta vaga não está disponível para seleção.");
        return; 
    }

    const currentUser = currentTeamUsers[currentUserIndex];
    const userName = currentUser.displayName;

    // Show password confirmation dialog
    const password = prompt(`${userName}, digite sua senha para confirmar escolha:`);
    
    // If the user cancels the prompt or enters an incorrect password
    if (password === null) {
        return; // User canceled
    } else if (password !== currentUser.senha) {
        alert("Senha incorreta. Tente novamente.");
        return;
    }

    if (scheduleVacancies[dateStr] > 0) {
        scheduleVacancies[dateStr]--;
        if (!scheduleAssignments[dateStr]) {
            scheduleAssignments[dateStr] = [];
        }
        scheduleAssignments[dateStr].push(userName);

        updateScheduleItemText(element, dateStr);

        currentUserIndex++;

        highlightCurrentUser();

        if (scheduleVacancies[dateStr] <= 0) {
            element.classList.add('full');
            element.style.pointerEvents = 'none'; 
        }
        
        // Update schedule info after assignment
        updateScheduleInfo();

        // Automatically save the schedule after successful assignment
        saveSchedule().catch(error => {
            console.error("Erro ao salvar automaticamente após escolha:", error);
        });

    } else {
        console.log(`No more vacancies for ${dateStr}`);
        element.classList.add('full'); 
        element.style.pointerEvents = 'none';
    }
}

function updateScheduleInfo() {
    if (currentTeamUsers.length > 0) {
        const totalVacancies = Object.values(scheduleVacancies).reduce((sum, val) => sum + val, 0);
        const remainingUsers = currentTeamUsers.length - currentUserIndex;
        scheduleInfoSpan.textContent = `${remainingUsers} militares, ${totalVacancies} vagas`;
        scheduleInfoSpan.style.display = 'inline';
        
        // Set color to red if there are fewer vacancies than remaining users
        if (totalVacancies < remainingUsers) {
            scheduleInfoSpan.style.color = '#dc3545'; // Bootstrap danger red
        } else {
            scheduleInfoSpan.style.color = '#666'; // Reset to default color
        }
    } else {
        scheduleInfoSpan.style.display = 'none';
    }
}

function updateScheduleItemText(listItem, dateStr) {
    const date = new Date(dateStr + 'T00:00:00'); 
    const dateDisplay = date.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const remainingVacancies = scheduleVacancies[dateStr];
    const assignments = scheduleAssignments[dateStr] || [];

    let text = `${dateDisplay}: ${remainingVacancies} vaga${remainingVacancies !== 1 ? 's' : ''}`;

    if (assignments.length > 0) {
        const assignedNames = assignments.map(name => `<strong>${name}</strong>`).join(', ');
        text += ` (${assignedNames})`;
    }

    listItem.innerHTML = text; 

    if (remainingVacancies <= 0) {
        listItem.classList.add('full');
        listItem.classList.remove('disabled'); 
        listItem.style.pointerEvents = 'none'; 
    } else {
        listItem.classList.remove('full');
    }
}

function highlightCurrentUser() {
    userListUl.innerHTML = '';
    
    if (currentUserIndex < currentTeamUsers.length) {
        // Add current user and highlight
        const currentUser = currentTeamUsers[currentUserIndex];
        const currentUserItem = document.createElement('li');
        currentUserItem.textContent = currentUser.displayName;
        currentUserItem.dataset.userIndex = currentUserIndex;
        currentUserItem.classList.add('active-selector');
        userListUl.appendChild(currentUserItem);
        
        // Add next user if available
        if (currentUserIndex + 1 < currentTeamUsers.length) {
            const nextUser = currentTeamUsers[currentUserIndex + 1];
            const nextUserItem = document.createElement('li');
            nextUserItem.textContent = nextUser.displayName;
            nextUserItem.dataset.userIndex = currentUserIndex + 1;
            userListUl.appendChild(nextUserItem);
        }
        
        enableScheduleClicks();
    } else {
        console.log("Todos os usuários tiveram sua vez.");
        disableScheduleClicks();
    }
}

function removeUserHighlight() {
    userListUl.querySelectorAll('li').forEach(li => {
        li.classList.remove('active-selector');
    });
    disableScheduleClicks(); 
}

function enableScheduleClicks() {
    generatedScheduleListUl.querySelectorAll('li').forEach(li => {
        if (!li.classList.contains('full')) {
            li.classList.remove('disabled');
            li.style.pointerEvents = 'auto'; 
        }
    });
}

function disableScheduleClicks() {
    generatedScheduleListUl.querySelectorAll('li').forEach(li => {
        if (!li.classList.contains('full')) { 
            li.style.pointerEvents = 'none'; 
            li.classList.add('disabled'); 
        }
    });
}

// Function to generate PDF of the schedule
function generatePDF() {
    if (!currentSelectedTeam || Object.keys(scheduleAssignments).length === 0) {
        alert("Selecione uma equipe e gere uma escala primeiro.");
        return;
    }

    // Load the required libraries using script tags instead of dynamic imports
    const jspdfScript = document.createElement('script');
    jspdfScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    document.head.appendChild(jspdfScript);
    
    jspdfScript.onload = function() {
        const autoTableScript = document.createElement('script');
        autoTableScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js';
        document.head.appendChild(autoTableScript);
        
        autoTableScript.onload = function() {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            // Add title
            doc.setFontSize(18);
            doc.text(`Escala da Equipe ${currentSelectedTeam}`, 14, 20);
            
            // Prepare data for table
            const tableData = [];
            selectedScaleDays.sort((a, b) => new Date(a) - new Date(b));
            
            selectedScaleDays.forEach(dateStr => {
                const date = new Date(dateStr + 'T00:00:00');
                const dateDisplay = date.toLocaleDateString('pt-BR', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                });
                
                const assignments = scheduleAssignments[dateStr] || [];
                const remainingVacancies = scheduleVacancies[dateStr] || 0;
                
                // Format matching the displayed schedule
                let rowText = `${dateDisplay}: ${remainingVacancies} vaga${remainingVacancies !== 1 ? 's' : ''}`;
                
                if (assignments.length > 0) {
                    const assignedNames = assignments.join(', ');
                    tableData.push([rowText, assignedNames]);
                } else {
                    tableData.push([rowText, 'Sem alocação']);
                }
            });
            
            // Create table
            doc.autoTable({
                head: [['Data', 'Policiais']],
                body: tableData,
                startY: 30,
                styles: { fontSize: 10 },
                headStyles: { fillColor: [66, 139, 202] }
            });
            
            // Add diagonal watermark
            doc.setTextColor(200, 200, 200);
            doc.setFontSize(60);
            doc.setGState(new doc.GState({ opacity: 0.3 }));
            
            // Rotate and position watermark - Fixed method
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            
            // Calculate center of page
            const centerX = pageWidth / 2;
            const centerY = pageHeight / 2;
            
            // Apply rotation for the watermark using proper transformation
            doc.text(currentSelectedTeam, centerX, centerY, {
                align: 'center',
                angle: -45
            });
            
            // Format filename based on date range (e.g., 10jun25a10jul25)
            const formatDateForFilename = (dateStr) => {
                const date = new Date(dateStr);
                const day = date.getDate().toString().padStart(2, '0');
                // Get first 3 letters of month name in Portuguese
                const monthNames = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 
                                    'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
                const month = monthNames[date.getMonth()];
                // Get last 2 digits of year
                const year = date.getFullYear().toString().slice(-2);
                return `${day}${month}${year}`;
            };
            
            // Get date objects from input fields
            const startDate = new Date(startDateInput.value);
            const endDate = new Date(endDateInput.value);
            
            const fileName = `${formatDateForFilename(startDate)}A${formatDateForFilename(endDate)}_${currentSelectedTeam.toUpperCase()}`;
            
            // Save PDF with the formatted filename
            doc.save(`${fileName}.pdf`);
        };
    };
}

// Add toggle function for schedule section
function toggleScheduleSection() {
    // Check if team is selected
    if (!currentSelectedTeam) {
        alert("Selecione uma equipe primeiro.");
        return;
    }
    
    // Generate password - team name plus reversed team name in uppercase
    const teamPassword = (currentSelectedTeam + currentSelectedTeam.split('').reverse().join('')).toUpperCase();
    const userPassword = prompt("Digite a senha para expandir/contrair esta seção:");
    
    if (userPassword !== teamPassword) {
        alert("Senha incorreta. Acesso negado.");
        return;
    }
    
    // Toggle the expanded state
    scheduleExpanded = !scheduleExpanded;
    updateSectionVisibility();
    
    // If we have a team selected, save the state to preserve it on reload
    if (currentSelectedTeam) {
        saveSchedule().catch(error => {
            console.error("Erro ao salvar estado expandido:", error);
        });
    }
}

// New function to update visibility based on expanded state
function updateSectionVisibility() {
    const inputs = scheduleInputContainer.querySelectorAll('.date-inputs, .limit-inputs, .calendar-container, .schedule-buttons');
    
    inputs.forEach(element => {
        element.style.display = scheduleExpanded ? '' : 'none';
    });
    
    toggleScheduleSectionButton.textContent = scheduleExpanded ? '−' : '+';
}

// Function to handle exceptions (add/remove vacancies)
function openExceptionModal() {
    if (!currentSelectedTeam) {
        alert("Selecione uma equipe primeiro.");
        return;
    }
    
    if (selectedScaleDays.length === 0) {
        alert("Gere uma escala primeiro antes de aplicar exceções.");
        return;
    }
    
    // Clear previous options
    exceptionDateSelect.innerHTML = '';
    
    // Populate date dropdown
    selectedScaleDays.sort((a, b) => new Date(a) - new Date(b));
    selectedScaleDays.forEach(dateStr => {
        const date = new Date(dateStr + 'T00:00:00');
        // Simplified date format for mobile
        const dateDisplay = date.toLocaleDateString('pt-BR', { 
            weekday: 'short', // Shortened weekday name for mobile
            month: 'short', 
            day: 'numeric' 
        });
        
        const option = document.createElement('option');
        option.value = dateStr;
        option.textContent = dateDisplay;
        exceptionDateSelect.appendChild(option);
    });
    
    // Show modal
    exceptionModal.style.display = 'block';
    
    // Scroll to modal for mobile
    exceptionModal.scrollIntoView({ behavior: 'smooth' });
}

function closeExceptionModal() {
    exceptionModal.style.display = 'none';
}

function applyException() {
    const dateStr = exceptionDateSelect.value;
    const action = vacancyActionSelect.value;
    const count = parseInt(vacancyCountInput.value, 10) || 1;
    
    if (!dateStr) {
        alert("Selecione uma data válida.");
        return;
    }
    
    if (count <= 0) {
        alert("A quantidade deve ser maior que zero.");
        return;
    }
    
    // Get current assignments for the date
    const currentAssignments = scheduleAssignments[dateStr] || [];
    
    if (action === 'add') {
        // Add vacancies
        scheduleVacancies[dateStr] = (scheduleVacancies[dateStr] || 0) + count;
    } else {
        // Remove vacancies
        const currentVacancies = scheduleVacancies[dateStr] || 0;
        const newVacancyCount = Math.max(0, currentVacancies - count);
        
        // If we're reducing vacancies below the number of assigned users
        if (newVacancyCount < currentAssignments.length) {
            // Calculate how many users need to be reassigned
            const reassignCount = currentAssignments.length - newVacancyCount;
            
            // Remove the most recently assigned users
            const usersToReassign = currentAssignments.slice(-reassignCount);
            
            // Update assignments
            scheduleAssignments[dateStr] = currentAssignments.slice(0, newVacancyCount);
            
            // Add removed users to reassignment queue
            reassignmentQueue = reassignmentQueue.concat(usersToReassign);
            
            // Alert that users need to be reassigned
            alert(`${reassignCount} militar(es) removido(s) da escala e precisam ser realocados: ${usersToReassign.join(', ')}`);
        }
        
        scheduleVacancies[dateStr] = newVacancyCount;
    }
    
    // Update UI
    updateScheduleUI();
    
    // Handle reassignments if needed
    processReassignmentQueue();
    
    // Update schedule info
    updateScheduleInfo();
    
    // Automatically save the schedule after applying the exception
    saveSchedule().catch(error => {
        console.error("Erro ao salvar automaticamente após exceção:", error);
    });
    
    // Close modal
    closeExceptionModal();
}

function updateScheduleUI() {
    // Update each schedule list item
    generatedScheduleListUl.querySelectorAll('li').forEach(li => {
        const dateStr = li.dataset.date;
        if (dateStr) {
            updateScheduleItemText(li, dateStr);
        }
    });
}

function processReassignmentQueue() {
    if (reassignmentQueue.length > 0) {
        // Find the names in the currentTeamUsers array
        const usersToReassign = [];
        reassignmentQueue.forEach(name => {
            const userIndex = currentTeamUsers.findIndex(user => user.displayName === name);
            if (userIndex >= 0) {
                usersToReassign.push(userIndex);
            }
        });
        
        // Reset currentUserIndex to the first user needing reassignment
        if (usersToReassign.length > 0) {
            currentUserIndex = usersToReassign[0];
            highlightCurrentUser();
            enableScheduleClicks();
            
            // Clear the queue
            reassignmentQueue = [];
        }
    }
}

// Create a new schedule while saving the current one
async function createNewSchedule() {
    if (!currentSelectedTeam) {
        alert("Selecione uma equipe primeiro.");
        return;
    }
    
    // Check if there are users who haven't made their selections yet
    const remainingUsers = currentTeamUsers.length - currentUserIndex;
    if (remainingUsers > 0) {
        const confirmMessage = `Ainda falta(m) ${remainingUsers} militar(es) para escolher seu(s) dia(s). Deseja fechar esta escala e gerar uma nova?`;
        if (!confirm(confirmMessage)) {
            return;
        }
    }
    
    try {
        // First save the current schedule
        await saveSchedule();
        
        // Reset the UI and state for a new schedule
        resetScheduleUI();
        
        // Clear but maintain the input fields
        const startDateValue = startDateInput.value;
        const endDateValue = endDateInput.value;
        const maxWeekdaysValue = maxWeekdaysInput.value;
        const maxWeekendsValue = maxWeekendsInput.value;
        
        // Generate a fresh calendar
        generateCalendar();
        
        alert("Nova escala iniciada. A escala anterior foi salva automaticamente.");
    } catch (error) {
        console.error("Erro ao criar nova escala:", error);
        alert(`Erro ao criar nova escala: ${error.message}`);
    }
}

// Function to open the saved schedules modal
function viewSavedSchedules() {
    if (!currentSelectedTeam) {
        alert("Selecione uma equipe primeiro.");
        return;
    }
    
    // Create modal if it doesn't exist
    if (!document.getElementById('savedSchedulesModal')) {
        createSavedSchedulesModal();
    }
    
    // Show modal
    const savedSchedulesModal = document.getElementById('savedSchedulesModal');
    savedSchedulesModal.style.display = 'block';
    
    // Populate with saved schedules
    loadSavedSchedules();
}

// Function to create saved schedules modal
function createSavedSchedulesModal() {
    const modal = document.createElement('div');
    modal.id = 'savedSchedulesModal';
    modal.classList.add('saved-schedules-modal');
    
    modal.innerHTML = `
        <div class="saved-schedules-content">
            <div class="saved-schedules-header">
                <h3>Escalas Fechadas - ${currentSelectedTeam}</h3>
                <span class="close-modal" id="closeSavedSchedulesModal">&times;</span>
            </div>
            <div class="schedules-list" id="schedulesList">
                <p class="no-schedules">Carregando escalas...</p>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add event listener to close button
    document.getElementById('closeSavedSchedulesModal').addEventListener('click', () => {
        modal.style.display = 'none';
    });
    
    // Close modal if user clicks outside
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
}

// Function to load saved schedules for current team
function loadSavedSchedules() {
    const schedulesList = document.getElementById('schedulesList');
    schedulesList.innerHTML = '<p class="no-schedules">Carregando escalas...</p>';
    
    // Reference to saved schedules archive for the team
    const archiveRef = ref(database, `scheduleArchive/${currentSelectedTeam}`);
    
    get(archiveRef).then((snapshot) => {
        if (snapshot.exists()) {
            const archives = snapshot.val();
            
            // Create HTML for each saved schedule
            let schedulesHTML = '';
            Object.entries(archives).forEach(([key, schedule]) => {
                let statusDisplay;
                
                // Format the dates for display
                const firstDate = schedule.selectedDays ? new Date(schedule.selectedDays[0] + 'T00:00:00') : null;
                const lastDate = schedule.selectedDays ? new Date(schedule.selectedDays[schedule.selectedDays.length - 1] + 'T00:00:00') : null;
                
                let dateRangeDisplay = 'Data não disponível';
                if (firstDate && lastDate) {
                    dateRangeDisplay = `${firstDate.toLocaleDateString('pt-BR')} a ${lastDate.toLocaleDateString('pt-BR')}`;
                }
                
                schedulesHTML += `
                    <div class="schedule-item" data-schedule-key="${key}">
                        <strong>${schedule.scheduleName || key}</strong>
                        <div>${dateRangeDisplay}</div>
                        <div class="archive-date">Arquivado em: ${new Date(schedule.archivedAt).toLocaleDateString('pt-BR')}</div>
                    </div>
                `;
            });
            
            // Also check for current schedule
            const currentScheduleRef = ref(database, `schedules/${currentSelectedTeam}`);
            get(currentScheduleRef).then((currentSnapshot) => {
                if (currentSnapshot.exists()) {
                    const currentData = currentSnapshot.val();
                    const isCompleted = currentData.currentUserIndex >= currentTeamUsers.length;
                    
                    // Get the date range for the current schedule
                    let dateRangeText = 'Datas não disponíveis';
                    if (currentData.selectedDays && currentData.selectedDays.length > 0) {
                        const firstDate = new Date(currentData.selectedDays[0] + 'T00:00:00');
                        const lastDate = new Date(currentData.selectedDays[currentData.selectedDays.length - 1] + 'T00:00:00');
                        dateRangeText = `${firstDate.toLocaleDateString('pt-BR')} a ${lastDate.toLocaleDateString('pt-BR')}`;
                    }
                    
                    schedulesHTML = `
                        <div class="schedule-item current-schedule" data-schedule-key="current">
                            <strong>Escala Atual</strong>
                            <div>Status: ${isCompleted ? 'Fechada' : 'Em andamento'}</div>
                            <div>${dateRangeText}</div>
                        </div>
                    ` + schedulesHTML;
                }
                
                if (schedulesHTML === '') {
                    schedulesList.innerHTML = '<p class="no-schedules">Nenhuma escala encontrada para esta equipe.</p>';
                } else {
                    schedulesList.innerHTML = schedulesHTML;
                    
                    // Add event listeners to load schedules
                    document.querySelectorAll('.schedule-item').forEach(item => {
                        item.addEventListener('click', function() {
                            const key = this.dataset.scheduleKey;
                            if (key === 'current') {
                                loadSchedule(currentSelectedTeam);
                                alert("Carregando escala em andamento. Você pode continuar a seleção de dias.");
                            } else {
                                loadArchivedSchedule(currentSelectedTeam, key);
                            }
                            document.getElementById('savedSchedulesModal').style.display = 'none';
                        });
                    });
                }
            });
        } else {
            // Check if there's at least a current schedule
            const currentScheduleRef = ref(database, `schedules/${currentSelectedTeam}`);
            get(currentScheduleRef).then((currentSnapshot) => {
                if (currentSnapshot.exists()) {
                    schedulesList.innerHTML = `
                        <div class="schedule-item" data-schedule-key="current">
                            <strong>Escala Atual</strong>
                            <div>Status: ${currentSnapshot.val().currentUserIndex >= currentTeamUsers.length ? 'Fechada' : 'Em andamento'}</div>
                        </div>
                    `;
                    
                    // Add event listener to load current schedule
                    document.querySelector('[data-schedule-key="current"]').addEventListener('click', () => {
                        loadSchedule(currentSelectedTeam);
                        document.getElementById('savedSchedulesModal').style.display = 'none';
                    });
                } else {
                    schedulesList.innerHTML = '<p class="no-schedules">Nenhuma escala encontrada para esta equipe.</p>';
                }
            });
        }
    }).catch((error) => {
        console.error("Erro ao carregar escalas:", error);
        schedulesList.innerHTML = `<p class="no-schedules">Erro ao carregar escalas: ${error.message}</p>`;
    });
}

// Function to load archived schedule
function loadArchivedSchedule(team, scheduleKey) {
    if (!team || !scheduleKey) return;

    try {
        get(ref(database, `scheduleArchive/${team}/${scheduleKey}`)).then((snapshot) => {
            if (snapshot.exists()) {
                const savedData = snapshot.val();
                console.log(`Escala arquivada ${scheduleKey} para ${team} encontrada. Tentando carregar...`, savedData);

                // Reset the UI and load the archived schedule
                resetScheduleUI();
                
                // Load the saved state
                scheduleAssignments = savedData.assignments || {};
                scheduleVacancies = savedData.vacancies || {};
                selectedScaleDays = savedData.selectedDays || [];
                currentUserIndex = savedData.currentUserIndex || 0;
                
                // Update max inputs if they were saved
                if (savedData.maxWeekdays !== undefined) maxWeekdaysInput.value = savedData.maxWeekdays;
                if (savedData.maxWeekends !== undefined) maxWeekdaysInput.value = savedData.maxWeekends;
                
                // Set expanded state from saved data
                scheduleExpanded = savedData.expanded !== undefined ? savedData.expanded : true;
                updateSectionVisibility();
                
                // Generate calendar to reflect selected days
                if (savedData.selectedDays && savedData.selectedDays.length > 0) {
                    // Set start/end dates based on the archived schedule
                    startDateInput.value = savedData.selectedDays[0];
                    endDateInput.value = savedData.selectedDays[savedData.selectedDays.length - 1];
                }
                generateCalendar();
                
                // Display the saved schedule
                displaySavedSchedule();
                highlightCurrentUser();
                
                // Update schedule info after loading saved data
                updateScheduleInfo();
                
                alert(`Escala arquivada ${scheduleKey} carregada com sucesso em modo somente visualização.`);
                
                // Disable editing for archived schedules
                disableScheduleClicks();
                
            } else {
                console.log(`Escala arquivada ${scheduleKey} não encontrada para a equipe ${team}.`);
                alert(`Escala arquivada não encontrada.`);
            }
        }).catch(error => {
            console.error("Erro ao carregar escala arquivada:", error);
            alert(`Erro ao carregar escala arquivada: ${error.message}`);
        });
    } catch (error) {
        console.error("Erro ao carregar escala arquivada:", error);
        alert(`Erro ao carregar escala arquivada: ${error.message}`);
    }
}

// Event listeners
startDateInput.addEventListener('change', generateCalendar);
endDateInput.addEventListener('change', generateCalendar);

generateScheduleButton.addEventListener('click', () => {
    console.log("Generating schedule with selected days:", selectedScaleDays);
    generateSchedule();
});
saveScheduleButton.addEventListener('click', saveSchedule);
resetScheduleButton.addEventListener('click', resetSchedule);
pdfScheduleButton.addEventListener('click', generatePDF);
toggleScheduleSectionButton.addEventListener('click', toggleScheduleSection);

useAutoScheduleCheckbox.addEventListener('change', function() {
    if (currentSelectedTeam) {
        // Reset selected days when toggling auto-schedule
        selectedScaleDays = [];
        generateCalendar();
    } else {
        alert("Selecione uma equipe primeiro antes de usar a escala automática.");
        useAutoScheduleCheckbox.checked = false;
    }
});

newScheduleButton.addEventListener('click', createNewSchedule);

exceptionButton.addEventListener('click', openExceptionModal);
closeModal.addEventListener('click', closeExceptionModal);
applyExceptionButton.addEventListener('click', applyException);

viewSavedSchedulesButton.addEventListener('click', viewSavedSchedules);

// Close modal if user clicks outside the modal content
window.addEventListener('click', (event) => {
    if (event.target === exceptionModal) {
        closeExceptionModal();
    }
});

// Initialize the page
displayTeamButtons();
// Set default dates for testing
const today = new Date();
startDateInput.valueAsDate = today;
const nextMonth = new Date(today);
nextMonth.setMonth(today.getMonth() + 1);
endDateInput.valueAsDate = nextMonth;
generateCalendar(); // Initialize calendar on page load