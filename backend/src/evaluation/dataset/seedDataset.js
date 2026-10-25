/**
 * Global_Fit_Ulttra - Seed Financial Evaluation Dataset Loader
 * 
 * Provides verified financial benchmark samples matching repository filings.
 * Validates data integrity using Zod schema.
 * 
 * @module evaluation/dataset/seedDataset
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateEvaluationDataset } from './datasetSchema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATASET_PATH = path.resolve(__dirname, '..', '..', '..', 'data', 'evaluation_datasets', 'financial_rag_benchmark.json');

/**
 * Loads and validates the benchmark evaluation dataset from JSON.
 * 
 * @param {string} [customPath]
 * @returns {object} Validated dataset with samples array
 */
export function loadEvaluationDataset(customPath = null) {
  const filePath = customPath || DEFAULT_DATASET_PATH;
  if (!fs.existsSync(filePath)) {
    throw new Error(`Evaluation dataset file not found at: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Malformed JSON in evaluation dataset: ${err.message}`);
  }

  const validation = validateEvaluationDataset(data);
  if (!validation.success) {
    const errorDetails = validation.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid evaluation dataset schema: ${errorDetails}`);
  }

  return validation.data;
}

export default loadEvaluationDataset;
