/**
 * Global_Fit_Ulttra - Financial Document Chunker
 * 
 * Specialized chunking utility designed for financial reports, SEC 10-K/10-Q filings,
 * earnings call transcripts, and central bank releases.
 * 
 * Key Features:
 * 1. Financial Section Identification (Item 1A Risk Factors, Item 7 MD&A, Statements).
 * 2. Table Integrity Preservation (Keeps tabular financial rows together).
 * 3. Token-Budgeted Sliding Window with Contextual Overlap.
 * 4. Rich Metadata Tagging (symbol, section, page, table flag).
 * 
 * @module utils/financialChunker
 */

// Common SEC and financial statement section headers
const FINANCIAL_SECTION_PATTERNS = [
  { name: 'Item 1A: Risk Factors', regex: /item\s+1a[.:\s]+risk\s+factors/i },
  { name: 'Item 7: MD&A', regex: /item\s+7[.:\s]+management['’s]*\s+discussion\s+and\s+analysis/i },
  { name: 'Item 1: Business Overview', regex: /item\s+1[.:\s]+business/i },
  { name: 'Item 8: Financial Statements', regex: /item\s+8[.:\s]+financial\s+statements/i },
  { name: 'Statements of Operations', regex: /statements?\s+of\s+(operations|income|earnings)/i },
  { name: 'Consolidated Balance Sheets', regex: /balance\s+sheets?/i },
  { name: 'Statements of Cash Flows', regex: /statements?\s+of\s+cash\s+flows?/i },
  { name: 'Segment Breakdown', regex: /(segment|market\s+platform)\s+revenue/i },
  { name: 'Monetary Policy Decision', regex: /(monetary\s+policy|federal\s+open\s+market\s+committee|fomc\s+statement)/i },
  { name: 'Executive Summary', regex: /(executive\s+summary|overview|highlights)/i },
];

/**
 * Approximates token count for English text (~4 chars per token).
 * @param {string} text 
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Checks if a block of text represents a financial data table.
 * @param {string} block 
 * @returns {boolean}
 */
export function isTableBlock(block) {
  if (!block) return false;
  // Markdown pipe tables
  if (block.includes('|') && block.split('\n').filter(l => l.includes('|')).length >= 2) {
    return true;
  }
  // Ascii divider lines + numbers
  const hasDividers = /[=-]{10,}/.test(block);
  const numberCount = (block.match(/\$?\d+[\d,.]*%?/g) || []).length;
  return hasDividers && numberCount >= 4;
}

/**
 * Detects current financial section based on text headings.
 * @param {string} text 
 * @returns {string}
 */
export function detectSection(text) {
  for (const { name, regex } of FINANCIAL_SECTION_PATTERNS) {
    if (regex.test(text)) {
      return name;
    }
  }
  return null;
}

/**
 * Chunks text into structured financial chunks with overlap and section preservation.
 * 
 * @param {string} fullText - Entire document text
 * @param {object} options
 * @param {number} [options.targetTokens=600] - Desired tokens per chunk
 * @param {number} [options.overlapTokens=80] - Token overlap between consecutive chunks
 * @param {object} [options.baseMetadata={}] - Initial metadata (symbol, filingType, etc.)
 * @returns {Array<{ chunkIndex: number, content: string, tokenCount: number, metadata: object }>}
 */
export function chunkFinancialText(fullText, options = {}) {
  const {
    targetTokens = 600,
    overlapTokens = 80,
    baseMetadata = {},
  } = options;

  if (!fullText || typeof fullText !== 'string' || fullText.trim().length === 0) {
    return [];
  }

  const targetChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;

  // Split into raw paragraphs or table blocks
  const rawParagraphs = fullText.split(/\n\s*\n/);
  const blocks = [];

  for (const p of rawParagraphs) {
    const trimmed = p.trim();
    if (trimmed.length > 0) {
      blocks.push(trimmed);
    }
  }

  const chunks = [];
  let currentBlockIndex = 0;
  let currentSection = 'Executive Overview';
  let chunkCounter = 0;

  while (currentBlockIndex < blocks.length) {
    let currentChunkText = '';
    let hasTable = false;
    const startIndex = currentBlockIndex;

    while (currentBlockIndex < blocks.length) {
      const block = blocks[currentBlockIndex];

      // Update section if detected
      const detected = detectSection(block);
      if (detected) {
        currentSection = detected;
      }

      if (isTableBlock(block)) {
        hasTable = true;
      }

      const projectedLength = currentChunkText.length + (currentChunkText ? 2 : 0) + block.length;

      // If adding this block exceeds target length and we already have content, finalize chunk
      if (projectedLength > targetChars && currentChunkText.length > 0) {
        break;
      }

      currentChunkText = currentChunkText ? `${currentChunkText}\n\n${block}` : block;
      currentBlockIndex++;

      // If single block itself is huge, break out
      if (currentChunkText.length >= targetChars) {
        break;
      }
    }

    // Safety fallback: if block itself was larger than targetChars, slice it gracefully
    if (currentChunkText.length > targetChars * 1.5) {
      const sentences = currentChunkText.split(/(?<=[.?!])\s+/);
      let subChunk = '';
      for (const sentence of sentences) {
        if ((subChunk.length + sentence.length) > targetChars && subChunk.length > 0) {
          chunks.push({
            chunkIndex: chunkCounter++,
            content: subChunk.trim(),
            tokenCount: estimateTokens(subChunk.trim()),
            metadata: {
              ...baseMetadata,
              section: currentSection,
              hasTable,
              pageNumber: Math.max(1, Math.floor(chunks.length / 3) + 1),
            }
          });
          // Retain overlap
          subChunk = subChunk.slice(-overlapChars) + ' ' + sentence;
        } else {
          subChunk = subChunk ? `${subChunk} ${sentence}` : sentence;
        }
      }
      if (subChunk.trim().length > 0) {
        chunks.push({
          chunkIndex: chunkCounter++,
          content: subChunk.trim(),
          tokenCount: estimateTokens(subChunk.trim()),
          metadata: {
            ...baseMetadata,
            section: currentSection,
            hasTable,
            pageNumber: Math.max(1, Math.floor(chunks.length / 3) + 1),
          }
        });
      }
    } else if (currentChunkText.trim().length > 0) {
      chunks.push({
        chunkIndex: chunkCounter++,
        content: currentChunkText.trim(),
        tokenCount: estimateTokens(currentChunkText.trim()),
        metadata: {
          ...baseMetadata,
          section: currentSection,
          hasTable,
          pageNumber: Math.max(1, Math.floor(chunks.length / 3) + 1),
        }
      });
    }

    // Overlap mechanism: step back by 1 block if possible to maintain context
    if (currentBlockIndex > startIndex + 1 && currentBlockIndex < blocks.length) {
      currentBlockIndex -= 1;
    }
  }

  return chunks;
}

export default {
  chunkFinancialText,
  estimateTokens,
  isTableBlock,
  detectSection,
};
