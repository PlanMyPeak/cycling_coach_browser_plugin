/**
 * Base Export Adapter Interface
 *
 * Defines the contract that all export adapters must implement.
 * Follows the adapter pattern to support multiple export destinations.
 */

import type { LibraryItem } from '@/types';
import type { PlanMyPeakAuthFailure } from '@/utils/planMyPeakAuthErrors';
import type { PlanImportReport } from '@/types/planImport.types';

/**
 * Base configuration for all export adapters
 */
export interface ExportConfig {
  /** Output file name (without extension) */
  fileName?: string;
  /** Whether to include metadata in export */
  includeMetadata?: boolean;
}

/**
 * Validation error or warning
 */
export interface ValidationMessage {
  field: string;
  message: string;
  severity: 'error' | 'warning';
  lostData?: string; // Description of what data will be lost
}

/**
 * Result of transformation validation
 */
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
}

/**
 * Result of export operation
 */
export interface ExportResult {
  success: boolean;
  fileUrl?: string; // Blob URL for download
  fileName: string;
  format: string;
  itemsExported: number;
  warnings: ValidationMessage[];
  errors?: string[];
  /**
   * Per-item outcome keyed by provider id, for destinations that upload item
   * by item. Additive: identically named workouts and partial failures are
   * attributable by id where `warnings`/`errors` only carry names.
   */
  itemResults?: ExportItemResult[];
  /**
   * Set when the destination refused the credential for good during this
   * export, whether before any item uploaded or part-way through. Carried as
   * data, not only as a message, so a batch can stop the remaining exports
   * and the surface can offer sign-in instead of repeating the error. Items
   * that already landed are still reported alongside it.
   */
  authFailure?: PlanMyPeakAuthFailure;
  /**
   * Set when the destination converted the export itself (the raw
   * training-plan import): the server's status and per-item outcomes, so a
   * result view can show what was imported without structure, skipped, or
   * not supported, beyond the flat warning list.
   */
  planImport?: PlanImportReport;
}

/** Outcome of exporting one item, identified by its provider id. */
export interface ExportItemResult {
  providerWorkoutId: string;
  success: boolean;
  /** Destination's id for the item, when it landed */
  remoteId?: string;
  /** Destination container the item landed in, when known */
  libraryName?: string;
  error?: string;
}

/**
 * Generic export adapter interface
 * @typeParam TConfig - Adapter-specific configuration extending ExportConfig
 * @typeParam TOutput - Target platform data structure
 */
export interface ExportAdapter<
  TConfig extends ExportConfig,
  TOutput = unknown,
> {
  /** Unique identifier for this adapter */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Description of what this adapter exports to */
  readonly description: string;

  /** Supported output formats (file extensions) */
  readonly supportedFormats: string[];

  /** Icon for UI display (optional) */
  readonly icon?: string;

  /**
   * Transform TrainingPeaks data to target format
   * @param items - Library items to transform
   * @param config - Adapter-specific configuration
   * @returns Transformed data in target format
   */
  transform(items: LibraryItem[], config: TConfig): Promise<TOutput>;

  /**
   * Validate transformed data meets target requirements
   * @param output - Transformed data
   * @returns Validation result with errors/warnings
   */
  validate(output: TOutput): Promise<ValidationResult>;

  /**
   * Execute the export (generate file, download, etc.)
   * @param output - Validated output data
   * @param config - Export configuration
   * @returns Export result with download URL
   */
  export(output: TOutput, config: TConfig): Promise<ExportResult>;
}
