import { initializeApp } from "firebase/app";
import { getDatabase, ref, query, orderByChild, equalTo, onValue, set, get, remove } from "firebase/database";
import { equipes, ehDiaDeTrabalho, formatDateYMD } from "./schedule-generator.js";

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
const generatedScheduleTitle = document.getElementById('generatedScheduleTitle');
const generatedScheduleListUl = document.getElementById('generatedScheduleList');

// Add toggle section button element
const toggleScheduleSectionButton = document.getElementById('toggleScheduleSection');
const scheduleInputContainer = document.getElementById('scheduleInputContainer');

// New element added from the plan
const useAutoScheduleCheckbox = document.getElementById('useAutoSchedule');

// State variables
let selectedScaleDays = [];
let currentTeamUsers = [];
let currentUserIndex = 0;
let scheduleVacancies = {};
let scheduleAssignments = {};
let currentSelectedTeam = null;
let scheduleExpanded = true; // Default state is expanded

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
        expanded: scheduleExpanded // Save the expanded state
    };

    try {
        await set(ref(database, `schedules/${currentSelectedTeam}`), scheduleData);
        console.log(`Escala para ${currentSelectedTeam} salva com sucesso!`);
        alert("Escala salva com sucesso!");
    } catch (error) {
        console.error("Erro ao salvar escala:", error);
        alert(`Erro ao salvar escala: ${error.message}`);
    }
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
                if (savedData.maxWeekdays) maxWeekdaysInput.value = savedData.maxWeekdays;
                if (savedData.maxWeekends) maxWeekendsInput.value = savedData.maxWeekends;
                
                // Set expanded state from saved data
                scheduleExpanded = savedData.expanded !== undefined ? savedData.expanded : true;
                updateSectionVisibility(); // Update UI based on expanded state
                
                // Generate calendar to reflect selected days
                generateCalendar();
                
                // Display the saved schedule
                displaySavedSchedule();
                highlightCurrentUser();

            } else {
                console.log(`Nenhuma escala salva encontrada para a equipe ${team}.`);
                resetScheduleUI(); // Reset schedule state if no saved schedule is found
                generateCalendar(); // Ensure calendar reflects current state
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
                    if (!selectedScaleDays.includes(formattedDate)) {
                        selectedScaleDays.push(formattedDate);
                    }
                } else if (selectedScaleDays.includes(formattedDate)) {
                    dayElement.classList.add('selected');
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

        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
        const vacancyLimit = isWeekend ? maxWeekends : maxWeekdays;

        scheduleVacancies[dateStr] = vacancyLimit;
        scheduleAssignments[dateStr] = scheduleAssignments[dateStr] || [];

        const listItem = document.createElement('li');
        listItem.dataset.date = dateStr; 

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
        scheduleAssignments[dateStr].push(userName);

        updateScheduleItemText(element, dateStr);

        currentUserIndex++;

        highlightCurrentUser();

        if (scheduleVacancies[dateStr] <= 0) {
            element.classList.add('full');
            element.style.pointerEvents = 'none'; 
        }

    } else {
        console.log(`No more vacancies for ${dateStr}`);
        element.classList.add('full'); 
        element.style.pointerEvents = 'none';
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
            
            // Save PDF
            doc.save(`escala_equipe_${currentSelectedTeam}.pdf`);
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

// --- Event Listeners ---

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

// Initialize the page
displayTeamButtons();
// Set default dates for testing
const today = new Date();
startDateInput.valueAsDate = today;
const nextMonth = new Date(today);
nextMonth.setMonth(today.getMonth() + 1);
endDateInput.valueAsDate = nextMonth;
generateCalendar(); // Initialize calendar on page load