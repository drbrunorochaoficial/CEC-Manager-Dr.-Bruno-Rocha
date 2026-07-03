/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  ClipboardList, 
  FileText, 
  Download, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  Plus,
  Stethoscope,
  Activity,
  User,
  Calendar,
  Clock,
  Weight,
  Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface PatientData {
  id: string;
  data: string;
  turno: string;
  paciente: string;
  prontuario: string;
  idade: string;
  peso: number;
  altura?: number;
  bsa?: number;
  diagnostico: string;
  proposta: string;
  // Interactive fields
  autolog: boolean;
  pericardioBovino: boolean;
  enxerto: string;
  outros: string;
}

interface CECMaterials {
  canulaArterial: string;
  canulaVCS: string;
  canulaVCI: string;
  tipoOxigenador: string;
  fluxoPadrao: string;
  fluxoMaxPercent: string;
  fluxoMaxAbsoluto: string;
}

// --- CEC Calculation Logic ---

const getCardiacIndex = (ageStr: string): number => {
  const normalized = ageStr.toLowerCase();
  let months = 999;

  const anoMatch = normalized.match(/(\d+)\s*ano/);
  const mesMatch = normalized.match(/(\d+)\s*mes/);
  const diaMatch = normalized.match(/(\d+)\s*dia/);

  if (anoMatch) {
    months = parseInt(anoMatch[1]) * 12;
    if (mesMatch) months += parseInt(mesMatch[1]);
  } else if (mesMatch) {
    months = parseInt(mesMatch[1]);
  } else if (diaMatch) {
    months = 0.5; // Menos de um mês
  }

  if (months < 3) return 3.2; // Menores que 2 meses (incluindo o 2º mês)
  if (months >= 3 && months <= 24) return 3.0; // 3 a 24 meses
  if (months > 24 && months <= 48) return 2.8; // 25 meses a 4 anos
  return 2.4; // Padrão / Acima de 4 anos
};

const calculateCEC = (peso: number, bsa?: number, idadeStr?: string): CECMaterials => {
  // If BSA is present, we use it to determine the tier and flow
  // Otherwise we fall back to weight-based tiers
  
  const useBSA = bsa !== undefined && bsa > 0;
  const ci = (useBSA && idadeStr) ? getCardiacIndex(idadeStr) : 2.4;
  
  // Define tiers based on either weight or BSA
  // Tiers are mapped to the materials provided in the initial prompt
  
  if ((useBSA && bsa <= 0.20) || (!useBSA && peso >= 2 && peso <= 3)) {
    const fluxo = useBSA ? `${(bsa * ci).toFixed(2)} L/min (CI ${ci})` : '150–200 mL/kg/min';
    return {
      canulaArterial: '8 Fr',
      canulaVCS: '12 Fr',
      canulaVCI: '12 Fr',
      tipoOxigenador: 'Sorin Lilliput 1 (D100)',
      fluxoPadrao: fluxo,
      fluxoMaxPercent: '175–200%',
      fluxoMaxAbsoluto: '700 mL/min'
    };
  } else if ((useBSA && bsa > 0.20 && bsa <= 0.28) || (!useBSA && peso > 3 && peso <= 5)) {
    const oxigenador = (useBSA ? bsa <= 0.24 : peso <= 4) ? 'Sorin Lilliput 1 (D100)' : 'Sorin Lilliput 2 (D101)';
    const maxAbs = (useBSA ? bsa <= 0.24 : peso <= 4) ? '700 mL/min' : '1.500 mL/min';
    const fluxo = useBSA ? `${(bsa * ci).toFixed(2)} L/min (CI ${ci})` : '150 mL/kg/min';
    return {
      canulaArterial: '8 a 10 Fr',
      canulaVCS: '12 a 14 Fr',
      canulaVCI: '12 a 14 Fr',
      tipoOxigenador: oxigenador,
      fluxoPadrao: fluxo,
      fluxoMaxPercent: (useBSA ? bsa <= 0.24 : peso <= 4) ? '85%' : '40%',
      fluxoMaxAbsoluto: maxAbs
    };
  } else if ((useBSA && bsa > 0.28 && bsa <= 0.38) || (!useBSA && peso > 5 && peso <= 8)) {
    const fluxo = useBSA ? `${(bsa * ci).toFixed(2)} L/min (CI ${ci})` : '150 mL/kg/min';
    return {
      canulaArterial: '10 Fr',
      canulaVCS: '14 Fr',
      canulaVCI: '14 a 16 Fr',
      tipoOxigenador: 'Sorin Lilliput 2 (D101)',
      fluxoPadrao: fluxo,
      fluxoMaxPercent: '70%',
      fluxoMaxAbsoluto: '1.500 mL/min'
    };
  } else if ((useBSA && bsa > 0.38 && bsa <= 0.52) || (!useBSA && peso > 8 && peso <= 12)) {
    const oxigenador = (useBSA ? bsa <= 0.45 : peso <= 10) ? 'Sorin Lilliput 2 (D101)' : 'Sorin Minimax Plus';
    const maxAbs = (useBSA ? bsa <= 0.45 : peso <= 10) ? '1.500 mL/min' : '2.500 mL/min';
    const fluxo = useBSA ? `${(bsa * ci).toFixed(2)} L/min (CI ${ci})` : '150 mL/kg/min';
    return {
      canulaArterial: '12 Fr',
      canulaVCS: '16 Fr',
      canulaVCI: '16 Fr',
      tipoOxigenador: oxigenador,
      fluxoPadrao: fluxo,
      fluxoMaxPercent: (useBSA ? bsa <= 0.45 : peso <= 10) ? '100%' : '60%',
      fluxoMaxAbsoluto: maxAbs
    };
  } else if ((useBSA && bsa > 0.52 && bsa <= 0.78) || (!useBSA && peso > 12 && peso <= 20)) {
    const fluxo = useBSA ? `${(bsa * ci).toFixed(2)} L/min (CI ${ci})` : '120 mL/kg/min';
    return {
      canulaArterial: '12 a 14 Fr',
      canulaVCS: '16 a 18 Fr',
      canulaVCI: '18 Fr',
      tipoOxigenador: 'Sorin Minimax Plus',
      fluxoPadrao: fluxo,
      fluxoMaxPercent: '77%',
      fluxoMaxAbsoluto: '2.500 mL/min'
    };
  } else if ((useBSA && bsa > 0.78 && bsa <= 1.05) || (!useBSA && peso > 20 && peso <= 30)) {
    const oxigenador = (useBSA ? bsa <= 0.92 : peso <= 25) ? 'Sorin Minimax Plus' : 'Sorin Synthesis / ECC.O';
    const maxAbs = (useBSA ? bsa <= 0.92 : peso <= 25) ? '2.500 mL/min' : '3.500 mL/min';
    const fluxo = useBSA ? `${(bsa * ci).toFixed(2)} L/min (CI ${ci})` : '100 mL/kg/min';
    return {
      canulaArterial: '14 Fr',
      canulaVCS: '18 Fr',
      canulaVCI: '18 a 20 Fr',
      tipoOxigenador: oxigenador,
      fluxoPadrao: fluxo,
      fluxoMaxPercent: (useBSA ? bsa <= 0.92 : peso <= 25) ? '100%' : '71%',
      fluxoMaxAbsoluto: maxAbs
    };
  } else if ((useBSA && bsa > 1.05 && bsa <= 1.28) || (!useBSA && peso > 30 && peso <= 40)) {
    const fluxo = useBSA ? `${(bsa * ci).toFixed(2)} L/min (CI ${ci})` : '80 mL/kg/min';
    return {
      canulaArterial: '14 a 16 Fr',
      canulaVCS: '18 a 20 Fr',
      canulaVCI: '20 Fr',
      tipoOxigenador: 'Sorin Synthesis / ECC.O',
      fluxoPadrao: fluxo,
      fluxoMaxPercent: '80%',
      fluxoMaxAbsoluto: '3.500 mL/min'
    };
  } else if ((useBSA && bsa > 1.28 && bsa <= 1.50) || (!useBSA && peso > 40 && peso <= 50)) {
    const fluxo = useBSA ? `${(bsa * ci).toFixed(2)} L/min (CI ${ci})` : '70 mL/kg/min';
    return {
      canulaArterial: '16 a 18 Fr',
      canulaVCS: '20 Fr',
      canulaVCI: '20 a 22 Fr',
      tipoOxigenador: 'Sorin Inspire 6F',
      fluxoPadrao: fluxo,
      fluxoMaxPercent: '63%',
      fluxoMaxAbsoluto: '5.000 mL/min'
    };
  } else if ((useBSA && bsa > 1.50) || (!useBSA && peso > 50)) {
    const fluxo = useBSA ? `${(bsa * ci).toFixed(2)} L/min (CI ${ci})` : '60–70 mL/kg/min';
    return {
      canulaArterial: '18 a 20 Fr',
      canulaVCS: '22 Fr',
      canulaVCI: '22 a 24 Fr',
      tipoOxigenador: 'Sorin Inspire 6F / 8F',
      fluxoPadrao: fluxo,
      fluxoMaxPercent: '66–77%',
      fluxoMaxAbsoluto: '5.000–7.000 mL/min'
    };
  }
  
  return {
    canulaArterial: 'N/A',
    canulaVCS: 'N/A',
    canulaVCI: 'N/A',
    tipoOxigenador: 'N/A',
    fluxoPadrao: 'N/A',
    fluxoMaxPercent: 'N/A',
    fluxoMaxAbsoluto: 'N/A'
  };
};

// --- Main Component ---

export default function App() {
  const [inputText, setInputText] = useState('');
  const [patients, setPatients] = useState<PatientData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  const parseInput = () => {
    setError(null);
    if (!inputText.trim()) {
      setError('Por favor, insira o texto da escala.');
      return;
    }

    const lines = inputText.split('\n').map(l => l.trim()).filter(l => l);
    const newPatients: PatientData[] = [];
    
    let currentDate = '';
    let currentTurn = '';
    let currentPatient: Partial<PatientData> | null = null;

    lines.forEach((line) => {
      // 1. Check for date (any line containing a date format)
      const dateMatch = line.match(/(\d{2}\/\d{2}\/\d{4})/);
      if (dateMatch) {
        currentDate = line;
        return;
      }

      // 2. Check for turn
      const normalizedLine = line.toLowerCase();
      if (['manhã', 'manha', 'tarde', 'noite'].some(t => normalizedLine.includes(t))) {
        currentTurn = line;
        return;
      }

      // 3. Check for Patient start
      const patientMatch = line.match(/^\s*PACIENTE\s*[-:]*\s*(.+)/i);
      if (patientMatch) {
        if (currentPatient && currentPatient.paciente) {
          if (!currentPatient.data) currentPatient.data = currentDate;
          if (!currentPatient.turno) currentPatient.turno = currentTurn;
          newPatients.push(currentPatient as PatientData);
        }
        currentPatient = {
          id: Math.random().toString(36).substr(2, 9),
          data: currentDate,
          turno: currentTurn,
          paciente: patientMatch[1].trim(),
          autolog: false,
          pericardioBovino: false,
          enxerto: '',
          outros: ''
        };
        return;
      }

      // If we don't have a patient yet, ignore the following parsing
      if (!currentPatient) return;

      // 4. Check for Prontuário
      const prontMatch = line.match(/^\s*(?:PRONTU[ÁA]RIO|PRONTUARIO|PRONT)\s*[-:]*\s*(.+)/i);
      if (prontMatch) {
        currentPatient.prontuario = prontMatch[1].trim();
        return;
      }

      // 5. Check for IDADE (can contain age, weight, and height inline)
      const idadeMatch = line.match(/^\s*IDADE\s*[-:]*\s*(.+)/i);
      if (idadeMatch) {
        const remaining = idadeMatch[1];
        
        // Extract age segment (everything up to PESO, ALTURA, ESTATURA)
        const ageSegmentMatch = remaining.match(/^(.*?)(?=\b(?:PESO|ALTURA|ESTATURA)\b|$)/i);
        if (ageSegmentMatch) {
          currentPatient.idade = ageSegmentMatch[1].replace(/\s+ou\s*$/i, '').trim();
        }

        // Parse Peso from the remaining text
        const pesoMatch = remaining.match(/(?:PESO|P)\s*[-:]*\s*(\d+([,.]\d+)?)\s*(?:KG|kg)?/i);
        if (pesoMatch) {
          currentPatient.peso = parseFloat(pesoMatch[1].replace(',', '.'));
        } else {
          // Fallback: look for a number followed directly by 'kg' anywhere in the line
          const kgMatch = remaining.match(/(\d+([,.]\d+)?)\s*kg/i);
          if (kgMatch) {
            currentPatient.peso = parseFloat(kgMatch[1].replace(',', '.'));
          } else {
            // Second fallback: just take the first number after IDADE segment
            const numbers = remaining.match(/(\d+([,.]\d+)?)/g);
            if (numbers && numbers.length > 0) {
              currentPatient.peso = parseFloat(numbers[0].replace(',', '.'));
            }
          }
        }

        // Parse Altura from the remaining text
        const alturaMatch = remaining.match(/(?:ALTURA|ESTATURA|A|E)\s*[-:]*\s*(\d+([,.]\d+)?)\s*(?:CM|cm|m)?/i) ||
                            remaining.match(/(\d+([,.]\d+)?)\s*CM/i);
        if (alturaMatch) {
          currentPatient.altura = parseFloat(alturaMatch[1].replace(',', '.'));
        } else {
          // Fallback: if there's a second number, and it seems like height (> 30 or unit cm)
          const cmMatch = remaining.match(/(\d+([,.]\d+)?)\s*cm/i);
          if (cmMatch) {
            currentPatient.altura = parseFloat(cmMatch[1].replace(',', '.'));
          } else {
            const numbers = remaining.match(/(\d+([,.]\d+)?)/g);
            if (numbers && numbers.length >= 2) {
              const secondNum = parseFloat(numbers[1].replace(',', '.'));
              if (secondNum > 30) currentPatient.altura = secondNum;
            }
          }
        }

        if (currentPatient.peso && currentPatient.altura) {
          // Mosteller Formula: BSA = sqrt( (W * H) / 3600 )
          currentPatient.bsa = Math.sqrt((currentPatient.peso * currentPatient.altura) / 3600);
        }
        return;
      }

      // If the line didn't start with IDADE, but has PESO or ALTURA explicitly on a separate line:
      const isolatedPesoMatch = line.match(/^\s*(?:PESO|P)\s*[-:]*\s*(\d+([,.]\d+)?)\s*(?:KG|kg)?/i);
      if (isolatedPesoMatch) {
        currentPatient.peso = parseFloat(isolatedPesoMatch[1].replace(',', '.'));
        // If we also have a height here
        const isolatedAlturaInPeso = line.match(/(?:ALTURA|ESTATURA|A|E)\s*[-:]*\s*(\d+([,.]\d+)?)\s*(?:CM|cm|m)?/i);
        if (isolatedAlturaInPeso) {
          currentPatient.altura = parseFloat(isolatedAlturaInPeso[1].replace(',', '.'));
        }
        if (currentPatient.peso && currentPatient.altura) {
          currentPatient.bsa = Math.sqrt((currentPatient.peso * currentPatient.altura) / 3600);
        }
        return;
      }

      const isolatedAlturaMatch = line.match(/^\s*(?:ALTURA|ESTATURA|A|E)\s*[-:]*\s*(\d+([,.]\d+)?)\s*(?:CM|cm|m)?/i);
      if (isolatedAlturaMatch) {
        currentPatient.altura = parseFloat(isolatedAlturaMatch[1].replace(',', '.'));
        if (currentPatient.peso && currentPatient.altura) {
          currentPatient.bsa = Math.sqrt((currentPatient.peso * currentPatient.altura) / 3600);
        }
        return;
      }

      // 6. Check for Diagnóstico
      const diagMatch = line.match(/^\s*(?:DIAGN[ÓO]STICO|DIAGNOSTICO|DIAG)\s*[-:]*\s*(.+)/i);
      if (diagMatch) {
        currentPatient.diagnostico = diagMatch[1].trim();
        return;
      }

      // 7. Check for Proposta
      const propMatch = line.match(/^\s*(?:PROPOSTA|PROPOST|PROP)\s*[-:]*\s*(.*)/i);
      if (propMatch) {
        currentPatient.proposta = propMatch[1].trim();
        return;
      }
    });

    if (currentPatient && currentPatient.paciente) {
      if (!currentPatient.data) currentPatient.data = currentDate;
      if (!currentPatient.turno) currentPatient.turno = currentTurn;
      newPatients.push(currentPatient as PatientData);
    }

    if (newPatients.length === 0) {
      setError('Nenhum paciente encontrado. Verifique o formato do texto.');
      return;
    }

    const invalid = newPatients.find(p => !p.data || !p.turno);
    if (invalid) {
      setError('Data e Turno são obrigatórios para todos os pacientes.');
      return;
    }

    setPatients(newPatients.slice(0, 10));
    setInputText('');
  };

  const updatePatient = (id: string, updates: Partial<PatientData>) => {
    setPatients(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const exportPDF = async () => {
    const element = document.getElementById('patients-list');
    if (!element || isGeneratingPDF) return;

    setIsGeneratingPDF(true);
    setError(null);

    try {
      // Scroll to top to ensure full capture
      window.scrollTo(0, 0);
      
      // Wait a bit for any layout shifts to settle
      await new Promise(resolve => setTimeout(resolve, 500));

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: '#F8F9FA',
        scrollY: -window.scrollY,
        onclone: (clonedDoc) => {
          // Ensure the cloned element is visible for capture
          const clonedElement = clonedDoc.getElementById('patients-list');
          if (clonedElement) {
            clonedElement.style.padding = '20px';
          }
        }
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      const imgProps = pdf.getImageProperties(imgData);
      const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      let heightLeft = imgHeight;
      let position = 0;

      // Add first page
      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeight);
      heightLeft -= pdfHeight;

      // Add subsequent pages
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeight);
        heightLeft -= pdfHeight;
      }

      // Standard save
      pdf.save('planejamento_cec_cards.pdf');
      
    } catch (err) {
      console.error('Erro ao gerar PDF:', err);
      setError('Erro ao gerar o PDF. Tente usar o botão "PDF (Tabela)" como alternativa.');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const exportTablePDF = () => {
    try {
      const pdf = new jsPDF('l', 'mm', 'a4'); // Landscape for table
      const headers = [['Data', 'Turno', 'Paciente', 'Prontuário', 'Peso', 'BSA', 'Cânula Art.', 'Cânula VCS', 'Cânula VCI', 'Oxigenador', 'Fluxo']];
      const data = patients.map(p => {
        const cec = calculateCEC(p.peso, p.bsa, p.idade);
        const bsaStr = p.bsa ? `${p.bsa.toFixed(2)} m²` : '-';
        return [
          p.data, p.turno, p.paciente, p.prontuario, `${p.peso}kg`, bsaStr,
          cec.canulaArterial, cec.canulaVCS, cec.canulaVCI, cec.tipoOxigenador, cec.fluxoPadrao
        ];
      });

      autoTable(pdf, {
        head: headers,
        body: data,
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235] }, // Blue-600
        styles: { fontSize: 8 },
        margin: { top: 20 }
      });

      pdf.text('Planejamento de Materiais de CEC - Dr. Bruno Rocha', 14, 15);
      
      const pdfBlob = pdf.output('blob');
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'planejamento_cec_tabela.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Erro ao gerar PDF de tabela:', err);
      setError('Erro ao gerar o PDF da tabela.');
    }
  };

  const exportCSV = () => {
    const headers = ['Data', 'Turno', 'Paciente', 'Prontuario', 'Idade', 'Peso', 'Altura', 'BSA', 'Diagnostico', 'Proposta', 'Canula Arterial', 'Canula VCS', 'Canula VCI', 'Oxigenador', 'Fluxo Padrao', 'Fluxo Max %', 'Fluxo Max Abs', 'Autolog', 'Pericardio Bovino', 'Enxerto', 'Outros'];
    const rows = patients.map(p => {
      const cec = calculateCEC(p.peso, p.bsa, p.idade);
      const bsaStr = p.bsa ? `${p.bsa.toFixed(2)} m²` : '';
      return [
        p.data, p.turno, p.paciente, p.prontuario, p.idade, p.peso, p.altura || '', bsaStr, p.diagnostico, p.proposta,
        cec.canulaArterial, cec.canulaVCS, cec.canulaVCI, cec.tipoOxigenador, cec.fluxoPadrao, cec.fluxoMaxPercent, cec.fluxoMaxAbsoluto,
        p.autolog ? 'Sim' : 'Não', p.pericardioBovino ? 'Sim' : 'Não', p.enxerto, p.outros
      ].map(val => `"${val}"`).join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', 'planejamento_cec.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#2D3436] font-sans pb-20">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
              <Stethoscope size={24} />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">CEC Planner</h1>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Dr. Bruno Rocha</p>
            </div>
          </div>
          
          {patients.length > 0 && (
            <div className="flex items-center gap-2">
              <button 
                onClick={exportPDF}
                disabled={isGeneratingPDF}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-semibold transition-all shadow-sm",
                  isGeneratingPDF 
                    ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed" 
                    : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                )}
              >
                {isGeneratingPDF ? (
                  <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                {isGeneratingPDF ? 'Gerando...' : 'PDF (Cards)'}
              </button>
              <button 
                onClick={exportTablePDF}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50 transition-colors shadow-sm"
              >
                <FileText size={16} />
                PDF (Tabela)
              </button>
              <button 
                onClick={exportCSV}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
              >
                <FileText size={16} />
                Exportar Tabela
              </button>
              <button 
                onClick={() => setPatients([])}
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title="Limpar tudo"
              >
                <Trash2 size={20} />
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {patients.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-3xl mx-auto"
          >
            <div className="bg-white rounded-3xl p-8 shadow-xl border border-gray-100">
              <div className="flex items-center gap-3 mb-6">
                <ClipboardList className="text-blue-600" size={28} />
                <h2 className="text-2xl font-bold">Carregar Escala</h2>
              </div>
              
              <p className="text-gray-600 mb-6 leading-relaxed">
                Cole aqui o texto da escala cirúrgica contendo as informações dos pacientes. 
                O sistema irá processar automaticamente os materiais de CEC necessários.
              </p>

              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Ex: Terça-Feira 10/03/2026... PACIENTE: PRISCILA..."
                className="w-full h-64 p-5 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all font-mono text-sm leading-relaxed"
              />

              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm font-medium">
                  <AlertCircle size={18} />
                  {error}
                </div>
              )}

              <button
                onClick={parseInput}
                className="w-full mt-6 py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 flex items-center justify-center gap-2"
              >
                <Plus size={24} />
                Processar Pacientes
              </button>
            </div>
          </motion.div>
        ) : (
          <div id="patients-list" className="grid grid-cols-1 lg:grid-cols-2 gap-8 p-4">
            <AnimatePresence>
              {patients.map((patient, index) => (
                <PatientCard 
                  key={patient.id} 
                  patient={patient} 
                  index={index}
                  onUpdate={(updates) => updatePatient(patient.id, updates)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
}

// --- Sub-components ---

interface PatientCardProps {
  patient: PatientData;
  index: number;
  onUpdate: (updates: Partial<PatientData>) => void;
  key?: React.Key;
}

function PatientCard({ 
  patient, 
  index, 
  onUpdate 
}: PatientCardProps) {
  const cec = useMemo(() => calculateCEC(patient.peso, patient.bsa, patient.idade), [patient.peso, patient.bsa, patient.idade]);

  const cardColors = [
    'border-blue-200 bg-blue-50/30',
    'border-emerald-200 bg-emerald-50/30',
    'border-violet-200 bg-violet-50/30',
    'border-amber-200 bg-amber-50/30',
    'border-rose-200 bg-rose-50/30',
    'border-indigo-200 bg-indigo-50/30',
    'border-cyan-200 bg-cyan-50/30',
    'border-orange-200 bg-orange-50/30',
    'border-teal-200 bg-teal-50/30',
    'border-fuchsia-200 bg-fuchsia-50/30',
  ];

  const colorClass = cardColors[index % cardColors.length];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={cn(
        "rounded-3xl border-2 p-6 shadow-sm transition-all flex flex-col gap-6",
        colorClass
      )}
    >
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 bg-white border border-gray-200 rounded text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Paciente {index + 1}
            </span>
            <span className="text-xs font-medium text-gray-400 flex items-center gap-1">
              <Calendar size={12} /> {patient.data}
            </span>
            <span className="text-xs font-medium text-gray-400 flex items-center gap-1">
              <Clock size={12} /> {patient.turno}
            </span>
          </div>
          <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <User size={20} className="text-gray-400" />
            {patient.paciente}
          </h3>
          <p className="text-sm text-gray-500 font-medium">Prontuário: {patient.prontuario}</p>
        </div>
        <div className="text-right">
          <div className="inline-flex flex-col items-end">
            <span className="text-2xl font-black text-blue-600">{patient.peso} <small className="text-sm font-bold">KG</small></span>
            {patient.altura && (
              <span className="text-sm font-bold text-gray-500">{patient.altura} cm</span>
            )}
            {patient.bsa && (
              <div className="flex flex-col items-end">
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold uppercase tracking-wider mb-1">
                  Cálculo por BSA
                </span>
                <span className="text-xs font-bold text-emerald-600">BSA: {patient.bsa.toFixed(2)} m²</span>
              </div>
            )}
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{patient.idade}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white/60 rounded-2xl p-4 border border-white/40">
          <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Diagnóstico</h4>
          <p className="text-sm font-medium leading-relaxed">{patient.diagnostico}</p>
        </div>
        <div className="bg-white/60 rounded-2xl p-4 border border-white/40">
          <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Proposta</h4>
          <p className="text-sm font-medium leading-relaxed">{patient.proposta}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
        <h4 className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-4 flex items-center gap-2">
          <Activity size={16} />
          Parâmetros de CEC
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-6">
          <ParamItem label="Cânula Arterial" value={cec.canulaArterial} />
          <ParamItem label="Cânula VCS" value={cec.canulaVCS} />
          <ParamItem label="Cânula VCI" value={cec.canulaVCI} />
          <ParamItem label="Oxigenador" value={cec.tipoOxigenador} />
          <ParamItem label="Fluxo Padrão" value={cec.fluxoPadrao} />
          <ParamItem label="Fluxo Máx (%)" value={cec.fluxoMaxPercent} />
          <ParamItem label="Fluxo Máx (Abs)" value={cec.fluxoMaxAbsoluto} className="col-span-2 md:col-span-1" />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <ToggleBtn 
            label="Autolog" 
            active={patient.autolog} 
            onClick={() => onUpdate({ autolog: !patient.autolog })} 
          />
          <ToggleBtn 
            label="Pericárdio Bovino" 
            active={patient.pericardioBovino} 
            onClick={() => onUpdate({ pericardioBovino: !patient.pericardioBovino })} 
          />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Enxerto</label>
            <input 
              type="text" 
              maxLength={30}
              value={patient.enxerto}
              onChange={(e) => onUpdate({ enxerto: e.target.value })}
              placeholder="Ex: Dacron 10mm"
              className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Outros</label>
            <input 
              type="text" 
              maxLength={30}
              value={patient.outros}
              onChange={(e) => onUpdate({ outros: e.target.value })}
              placeholder="Observações adicionais"
              className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ParamItem({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("space-y-0.5", className)}>
      <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider block">{label}</span>
      <span className="text-sm font-bold text-gray-800">{value}</span>
    </div>
  );
}

function ToggleBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border shadow-sm",
        active 
          ? "bg-emerald-500 text-white border-emerald-600 shadow-emerald-100" 
          : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
      )}
    >
      {active ? <CheckCircle2 size={14} /> : <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300" />}
      {label}
    </button>
  );
}
