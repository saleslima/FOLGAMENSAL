// Brazilian holidays for São Paulo
const fixedHolidays = {
  // National Holidays
  "01-01": "Ano Novo",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "09-07": "Independência do Brasil",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República", 
  "12-25": "Natal",
  
  // São Paulo State Holidays
  "01-25": "Aniversário de São Paulo",
  "07-09": "Revolução Constitucionalista",
  
  // São Paulo City Holidays
  "11-20": "Dia da Consciência Negra"
};

// Calculate Easter Sunday for a given year
function calculateEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  
  return new Date(year, month, day);
}

// Get all holidays for a given year, including variable dates
function getHolidays(year) {
  const holidays = { ...fixedHolidays };
  const results = {};
  
  // Add fixed holidays for the specified year
  Object.keys(holidays).forEach(key => {
    const [month, day] = key.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const formattedDate = formatDateYMD(date);
    results[formattedDate] = holidays[key];
  });
  
  // Calculate Easter and related holidays
  const easter = calculateEaster(year);
  
  // Carnival (Monday and Tuesday before Ash Wednesday, which is 46 days before Easter)
  const carnival1 = new Date(easter);
  carnival1.setDate(easter.getDate() - 48); // Monday
  results[formatDateYMD(carnival1)] = "Carnaval (Segunda)";
  
  const carnival2 = new Date(easter);
  carnival2.setDate(easter.getDate() - 47); // Tuesday
  results[formatDateYMD(carnival2)] = "Carnaval (Terça)";
  
  // Good Friday (Friday before Easter)
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);
  results[formatDateYMD(goodFriday)] = "Sexta-feira Santa";
  
  // Easter itself (sometimes considered a holiday)
  results[formatDateYMD(easter)] = "Páscoa";
  
  // Corpus Christi (60 days after Easter)
  const corpusChristi = new Date(easter);
  corpusChristi.setDate(easter.getDate() + 60);
  results[formatDateYMD(corpusChristi)] = "Corpus Christi";
  
  return results;
}

// Helper function from schedule-generator.js to maintain consistency
function formatDateYMD(date) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Check if a date is a holiday
function isHoliday(date) {
  const year = date.getFullYear();
  const holidays = getHolidays(year);
  const formattedDate = formatDateYMD(date);
  return formattedDate in holidays;
}

// Get the holiday name if it exists
function getHolidayName(date) {
  const year = date.getFullYear();
  const holidays = getHolidays(year);
  const formattedDate = formatDateYMD(date);
  return holidays[formattedDate] || null;
}

// Check if a date is a weekend (Saturday or Sunday)
function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
}

export { isHoliday, isWeekend, getHolidayName, getHolidays };