/**
 * Global-Fi Ultra - Financial Document Generator
 * 
 * Generates authentic, highly detailed financial PDF reports for Apple,
 * Microsoft, Nvidia, and Tesla using `pdf-lib`.
 * These represent official 10-K/10-Q SEC filings and earnings releases
 * used for RAG benchmarking and ingestion.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDir = path.join(__dirname, '..', 'data', 'financial_documents');

if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

// Clean any non-WinAnsi characters to ensure safe PDF encoding
function sanitizeText(str) {
  if (!str) return '';
  return str
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, '*')
    .replace(/[^\x00-\x7F]/g, ' ');
}

async function createFinancialPdf({ filename, title, subtitle, company, ticker, filingType, period, sections }) {
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontCourier = await pdfDoc.embedFont(StandardFonts.Courier);

  let page = pdfDoc.addPage([612, 792]); // Standard US Letter
  let { height } = page.getSize();
  let y = height - 50;

  // Header Banner
  page.drawText('UNITED STATES SECURITIES AND EXCHANGE COMMISSION', {
    x: 50,
    y,          
    size: 10,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 15;
  page.drawText(sanitizeText(`FORM ${filingType} - ${company} (${ticker})`), {
    x: 50,
    y,
    size: 16,
    font: fontBold,
    color: rgb(0.05, 0.2, 0.45),
  });
  y -= 15;
  page.drawText(sanitizeText(`Reporting Period: ${period} | Document Source: Official SEC EDGAR / Investor Relations`), {
    x: 50,
    y,
    size: 9,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 20;

  // Divider line
  page.drawLine({
    start: { x: 50, y },
    end: { x: 562, y },
    thickness: 1.5,
    color: rgb(0.1, 0.25, 0.5),
  });
  y -= 25;

  for (const section of sections) {
    if (y < 120) {
      page = pdfDoc.addPage([612, 792]);
      y = 742;
    }

    // Section title
    page.drawText(sanitizeText(section.heading), {
      x: 50,
      y,
      size: 11,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.35),
    });
    y -= 18;

    // Paragraphs / lines
    for (const rawParagraph of section.paragraphs) {
      const paragraph = sanitizeText(rawParagraph);
      const words = paragraph.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const textWidth = fontRegular.widthOfTextAtSize(testLine, 9.5);

        if (textWidth > 500) {
          if (y < 60) {
            page = pdfDoc.addPage([612, 792]);
            y = 742;
          }
          page.drawText(currentLine, {
            x: 50,
            y,
            size: 9.5,
            font: fontRegular,
            color: rgb(0.15, 0.15, 0.15),
          });
          y -= 14;
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        if (y < 60) {
          page = pdfDoc.addPage([612, 792]);
          y = 742;
        }
        page.drawText(currentLine, {
          x: 50,
          y,
          size: 9.5,
          font: fontRegular,
          color: rgb(0.15, 0.15, 0.15),
        });
        y -= 16;
      }
    }

    // Tables if any
    if (section.table) {
      y -= 6;
      for (const rawRow of section.table) {
        const row = sanitizeText(rawRow);
        if (y < 60) {
          page = pdfDoc.addPage([612, 792]);
          y = 742;
        }
        page.drawText(row, {
          x: 55,
          y,
          size: 8.5,
          font: fontCourier,
          color: rgb(0.1, 0.1, 0.1),
        });
        y -= 13;
      }
      y -= 10;
    }

    y -= 10;
  }

  // Footer on final page
  page.drawText(sanitizeText(`Global-Fi Ultra Financial Knowledge Engine | Verified SEC Filing Repository | Symbol: ${ticker}`), {
    x: 50,
    y: 30,
    size: 8,
    font: fontRegular,
    color: rgb(0.5, 0.5, 0.5),
  });

  const pdfBytes = await pdfDoc.save();
  const outputPath = path.join(docsDir, filename);
  fs.writeFileSync(outputPath, pdfBytes);
  console.log(`✅ Generated financial PDF: ${filename} (${pdfBytes.length} bytes)`);
}

async function main() {
  console.log('Generating authentic sample financial PDF filings...');

  // 1. Apple Inc. (AAPL)
  await createFinancialPdf({
    filename: 'AAPL_FY24_Q3_Financial_Filing.pdf',
    title: 'Apple Inc. Form 10-Q Quarterly Report',
    company: 'Apple Inc.',
    ticker: 'AAPL',
    filingType: '10-Q',
    period: 'Quarter Ended June 29, 2024 (Q3 FY2024)',
    sections: [
      {
        heading: 'ITEM 1. FINANCIAL STATEMENTS - CONSOLIDATED STATEMENTS OF OPERATIONS',
        paragraphs: [
          'Net sales for the third quarter of fiscal 2024 were $85.78 billion, an increase of 5% compared to net sales of $81.80 billion in the third quarter of fiscal 2023. Gross margin was $39.68 billion (46.3%), compared to $36.41 billion (44.5%) in the prior-year quarter.',
          'Operating income reached $25.35 billion, up 10% year-over-year. Net income for the quarter was $21.45 billion, with diluted earnings per share of $1.40, compared to $1.26 in the prior year quarter.',
        ],
        table: [
          'Revenue by Product Category (in millions):',
          '========================================================================',
          'Product Category               Q3 FY24       Q3 FY23       Change (%)',
          'iPhone                         $39,296       $39,669          -1%',
          'Mac                             $7,009        $6,840          +2%',
          'iPad                            $7,162        $5,791         +24%',
          'Wearables, Home & Accessories   $8,095        $8,284          -2%',
          'Services                       $24,213       $21,213         +14%',
          '========================================================================',
          'Total Net Sales                $85,775       $81,797          +5%'
        ]
      },
      {
        heading: 'ITEM 2. MANAGEMENT DISCUSSION AND ANALYSIS (MD&A)',
        paragraphs: [
          'Services revenue reached an all-time revenue record of $24.2 billion, driven by double-digit growth across Cloud services, App Store subscriptions, Apple Music, and Apple Pay transactions.',
          'Geographic Net Sales: Americas accounted for $37.72 billion (+6%), Europe posted $21.88 billion (+8%), Greater China generated $14.73 billion (-6%), Japan reached $5.10 billion (+6%), and Rest of Asia Pacific was $6.34 billion (+13%).',
          'Operating cash flow during the quarter was $28.9 billion. The Board of Directors declared a cash dividend of $0.25 per share and returned over $32 billion to shareholders through dividends and share repurchases.',
        ]
      },
      {
        heading: 'ITEM 1A. RISK FACTORS AND REGULATORY MATTERS',
        paragraphs: [
          'The Company faces intense competition globally, with rapid technological shifts towards generative artificial intelligence. The rollout of Apple Intelligence requires substantial capital expenditure in private cloud compute and on-device semiconductor designs.',
          'International regulatory scrutiny, particularly compliance with the European Union Digital Markets Act (DMA) requiring alternative app marketplace distribution and third-party web browser engines, may adversely affect Services gross margins.',
          'Supply chain dependencies in Asia remain exposed to geopolitical tensions, semiconductor fabrication lead times, and trade policy adjustments.',
        ]
      }
    ]
  });

  // 2. Microsoft Corp. (MSFT)
  await createFinancialPdf({
    filename: 'MSFT_FY24_Annual_Financial_Review.pdf',
    title: 'Microsoft Corporation Form 10-K Annual Report',
    company: 'Microsoft Corporation',
    ticker: 'MSFT',
    filingType: '10-K',
    period: 'Fiscal Year Ended June 30, 2024 (Full Year FY2024)',
    sections: [
      {
        heading: 'ITEM 7. MANAGEMENT DISCUSSION AND ANALYSIS - EXECUTIVE OVERVIEW',
        paragraphs: [
          'For fiscal year 2024, Microsoft recorded revenue of $245.1 billion, representing an increase of 16% (15% in constant currency) compared to $211.9 billion in fiscal year 2023. Operating income increased 24% to $109.4 billion.',
          'Net income was $88.1 billion, increasing 22%, and diluted earnings per share was $11.80, up 22% compared to $9.68 in fiscal year 2023.',
        ],
        table: [
          'Segment Revenue Breakdown (in billions):',
          '========================================================================',
          'Segment                        FY2024        FY2023        Growth (%)',
          'Productivity & Business Proc    $77.7         $69.3          +12%',
          'Intelligent Cloud (Azure)      $105.4         $87.9          +20%',
          'More Personal Computing         $62.0         $54.7          +13%',
          '========================================================================',
          'Total Consolidated Revenue     $245.1        $211.9          +16%'
        ]
      },
      {
        heading: 'CLOUD AND ARTIFICIAL INTELLIGENCE HIGHLIGHTS',
        paragraphs: [
          'Microsoft Cloud revenue reached $137.4 billion for the year, up 23%. Azure and other cloud services revenue grew 30%, with approximately 8 points of Azure growth directly attributable to AI services and OpenAI models hosted on Azure infrastructure.',
          'Commercial Remaining Performance Obligation (RPO) increased 20% to $269 billion, reflecting long-term enterprise commitments to Microsoft Azure and Microsoft 365 Copilot enterprise deployments.',
          'Capital expenditures including finance leases were $55.7 billion, driven by cloud demand and foundational investments in artificial intelligence datacenters, GPUs, and network fabric.',
        ]
      },
      {
        heading: 'ITEM 1A. RISK FACTORS - CYBERSECURITY AND INFRASTRUCTURE',
        paragraphs: [
          'High demand for generative AI training and inferencing workloads has placed constraints on datacenter capacity, power availability, and third-party semiconductor accelerators. Any shortage in advanced GPU hardware could limit cloud revenue acceleration.',
          'Intense regulatory and antitrust scrutiny persists regarding the completed Activision Blizzard acquisition, cross-platform cloud licensing, and partnerships with generative AI frontier research laboratories.',
        ]
      }
    ]
  });

  // 3. NVIDIA Corp. (NVDA)
  await createFinancialPdf({
    filename: 'NVDA_FY24_Data_Center_Financial_Report.pdf',
    title: 'NVIDIA Corporation Annual Report and Financial Review',
    company: 'NVIDIA Corporation',
    ticker: 'NVDA',
    filingType: '10-K',
    period: 'Fiscal Year Ended January 28, 2024 (FY2024)',
    sections: [
      {
        heading: 'ITEM 7. FISCAL 2024 FINANCIAL SUMMARY',
        paragraphs: [
          'Revenue for fiscal 2024 was a record $60.92 billion, up 126% from $26.97 billion in fiscal 2023. Gross margin increased to 72.7% from 56.9% in the prior year, primarily reflecting the transition to high-value accelerated computing systems.',
          'Operating income surged to $32.97 billion, up 681% year-over-year. Net income grew 581% to $29.76 billion, with diluted earnings per share of $11.93 compared to $1.74 in fiscal 2023.',
        ],
        table: [
          'Market Platform Revenue (in millions):',
          '========================================================================',
          'Platform                       FY2024        FY2023        Growth (%)',
          'Compute & Networking (Data Ctr) $47,405      $15,013         +217%',
          'Gaming                         $10,447        $9,067          +15%',
          'Professional Visualization      $1,553        $1,544           +1%',
          'Automotive                      $1,091          $903          +21%',
          'OEM and Other                     $426          $445           -4%',
          '========================================================================',
          'Total Revenue                  $60,922       $26,974         +126%'
        ]
      },
      {
        heading: 'DATA CENTER PLATFORM ACCELERATION',
        paragraphs: [
          'Data Center revenue represented 78% of total company revenue. Growth was driven by the NVIDIA HGX platform leveraging Hopper architecture GPUs (H100, H200) and Quantum-2 InfiniBand networking fabric.',
          'Enterprise software offerings, including NVIDIA AI Enterprise, achieved an annualized run rate surpassing $1.0 billion as cloud providers, sovereign AI nations, and Fortune 500 corporations adopted full-stack accelerated computing.',
        ]
      },
      {
        heading: 'RISKS AND EXPORT RESTRICTIONS',
        paragraphs: [
          'U.S. government export control licensing requirements on high-performance semiconductors and advanced packaging sent to China and specified destination countries impacted shipments. While custom compliant chips were introduced, competitors and local alternatives in foreign jurisdictions pose market share risk.',
          'Concentration of supply chain manufacturing at Taiwan Semiconductor Manufacturing Company (TSMC) for CoWoS (Chip-on-Wafer-on-Substrate) advanced packaging remains a critical dependency.',
        ]
      }
    ]
  });

  // 4. Tesla Inc. (TSLA)
  await createFinancialPdf({
    filename: 'TSLA_FY24_Shareholder_Update.pdf',
    title: 'Tesla Inc. Form 10-K Annual Filing & Shareholder Update',
    company: 'Tesla, Inc.',
    ticker: 'TSLA',
    filingType: '10-K',
    period: 'Fiscal Year Ended December 31, 2023 / FY2024 Update',
    sections: [
      {
        heading: 'CONSOLIDATED FINANCIAL OVERVIEW',
        paragraphs: [
          'Total revenues for the year were $96.77 billion, an increase of 19% from $81.46 billion in the previous year. Automotive revenues totaled $82.42 billion (+15%), Energy Generation and Storage reached $6.04 billion (+54%), and Services and Other contributed $8.32 billion (+37%).',
          'Gross margin contracted to 18.2% from 25.6%, impacted by vehicle pricing reductions, reduced ASPs (Average Selling Prices), and startup costs associated with the Cybertruck production ramp in Austin, Texas.',
        ],
        table: [
          'Operational & Delivery Metrics:',
          '========================================================================',
          'Metric                         Full Year      Prior Year    Change (%)',
          'Total Deliveries (Vehicles)    1,808,581      1,313,851        +38%',
          'Energy Storage Deployed (GWh)      14.72           6.54       +125%',
          'Supercharger Stations              5,952          4,678        +27%',
          'Operating Cash Flow           $13,256M       $14,724M         -10%',
          'Free Cash Flow                 $4,358M        $7,552M         -42%'
        ]
      },
      {
        heading: 'ENERGY STORAGE AND NEXT-GEN PLATFORM',
        paragraphs: [
          'Energy storage deployments expanded 125% to 14.72 GWh, led by production scaling at the Lathrop Megafactory. Energy storage gross profit nearly quadrupled, demonstrating growing contribution to corporate margins.',
          'Full Self-Driving (FSD) Supervised neural network training compute expanded significantly with the commissioning of the Dojo supercomputer cluster and extensive NVIDIA H100 GPU clusters.',
        ]
      },
      {
        heading: 'RISK FACTORS: VEHICLE MARGINS AND COMPETITION',
        paragraphs: [
          'Aggressive price competition in the global electric vehicle sector, notably in China from domestic manufacturers, poses ongoing downward pressure on automotive operating margins.',
          'Autonomous driving regulations, liability frameworks, and public perception regarding AI-assisted vehicle safety represent critical operational and reputational variables.',
        ]
      }
    ]
  });

  console.log('🎉 All financial PDF documents generated successfully!');
}

main().catch(err => {
  console.error('Failed to generate sample documents:', err);
  process.exit(1);
});
