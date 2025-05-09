// Configurações de cada equipe: data de início e padrão de turnos
const equipes = {
  ALPHA: {
    inicio: new Date(2025, 3, 1), // 1 de abril de 2025
    padrao: [2, 3]
  },
  ECHO: {
    inicio: new Date(2025, 3, 1),
    padrao: [3, 2]
  },
  BRAVO: {
    inicio: new Date(2025, 3, 2),
    padrao: [3, 2]
  },
  CHARLIE: {
    inicio: new Date(2025, 3, 2),
    padrao: [2, 3]
  },
  DELTA: {
    inicio: new Date(2025, 3, 3),
    padrao: [2, 3]
  }
};

// Gera todos os dias de trabalho de uma equipe até um certo ano (inclusive)
function gerarDiasDeTrabalho(equipeNome, anoFinal) {
  const equipe = equipes[equipeNome];
  const { inicio, padrao } = equipe;

  const diasTrabalho = [];
  let atual = new Date(inicio);
  let i = 0;

  const fim = new Date(anoFinal + 1, 0, 1); // 1 de jan do ano seguinte

  while (atual < fim) {
    diasTrabalho.push(new Date(atual));
    const proximoDia = padrao[i % padrao.length];
    atual.setDate(atual.getDate() + proximoDia);
    i++;
  }

  return diasTrabalho;
}

// Filtra os dias de uma equipe para um mês/ano específico
function diasNoMes(equipeNome, ano, mes) {
  const todosDias = gerarDiasDeTrabalho(equipeNome, ano);
  return todosDias
    .filter(d => d.getFullYear() === ano && d.getMonth() === mes)
    .map(d => d.getDate());
}

// Verifica se uma data específica é dia de trabalho para uma equipe
function ehDiaDeTrabalho(equipeNome, data) {
  const todosDias = gerarDiasDeTrabalho(equipeNome, data.getFullYear());
  return todosDias.some(d => 
    d.getFullYear() === data.getFullYear() && 
    d.getMonth() === data.getMonth() && 
    d.getDate() === data.getDate()
  );
}

// Formata a data para string no formato YYYY-MM-DD
function formatDateYMD(date) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export { equipes, gerarDiasDeTrabalho, diasNoMes, ehDiaDeTrabalho, formatDateYMD };