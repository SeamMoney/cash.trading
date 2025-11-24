import { MAKER_REBATE, BUILDER_FEE } from './decibel-client';
import { EXECUTION_MODES, ExecutionMode } from './twap-bot';

/**
 * Calculate volume from budget
 */
export function calculateVolumeFromBudget(budget: number): number {
  const effectiveFee = BUILDER_FEE - MAKER_REBATE;
  return budget / effectiveFee;
}

/**
 * Calculate budget from volume
 */
export function calculateBudgetFromVolume(volume: number): number {
  const effectiveFee = BUILDER_FEE - MAKER_REBATE;
  return volume * effectiveFee;
}

/**
 * Calculate required margin
 */
export function calculateRequiredMargin(params: {
  volume: number;
  leverage: number;
  executionMode: ExecutionMode;
  directionalBias: number;
}): number {
  const modeConfig = EXECUTION_MODES[params.executionMode];

  // Base margin calculation
  const baseMargin = (params.volume / params.leverage) * modeConfig.safetyBuffer;

  // Directional bias adjustment (increases margin requirement)
  const biasAdjustment = 1 + Math.abs(params.directionalBias) * 0.2;

  return baseMargin * biasAdjustment;
}

/**
 * Get margin warning level
 * Returns: 'safe' | 'warning' | 'danger'
 */
export function getMarginWarningLevel(
  requiredMargin: number,
  availableMargin: number
): 'safe' | 'warning' | 'danger' {
  const ratio = requiredMargin / availableMargin;

  if (ratio > 0.9) {
    return 'danger';
  } else if (ratio > 0.7) {
    return 'warning';
  } else {
    return 'safe';
  }
}

/**
 * Calculate estimated duration for TWAP execution
 */
export function calculateEstimatedDuration(params: {
  volume: number;
  executionMode: ExecutionMode;
  dailyVolume: number;
}): number {
  const modeConfig = EXECUTION_MODES[params.executionMode];

  // Calculate duration based on participation rate
  const targetDuration = params.volume / (params.dailyVolume * modeConfig.participationRate / 86400);

  // Apply minimum duration
  return Math.max(modeConfig.minDuration, targetDuration);
}

/**
 * Format seconds to human readable duration
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

/**
 * Calculate alpha tilt from directional bias
 */
export function calculateAlphaTilt(directionalBias: number): number {
  return directionalBias * 0.2;
}

/**
 * Calculate fee breakdown
 */
export function calculateFeeBreakdown(volume: number): {
  makerRebate: number;
  builderFee: number;
  netFee: number;
  budget: number;
} {
  const makerRebate = volume * MAKER_REBATE;
  const builderFee = volume * BUILDER_FEE;
  const netFee = builderFee - makerRebate;

  return {
    makerRebate,
    builderFee,
    netFee,
    budget: netFee,
  };
}

/**
 * Validate bot configuration
 */
export function validateBotConfig(params: {
  budget?: number;
  volume?: number;
  leverage: number;
  directionalBias: number;
  executionMode: ExecutionMode;
  availableMargin: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check budget or volume provided
  if (!params.budget && !params.volume) {
    errors.push('Either budget or volume must be provided');
  }

  // Calculate volume if not provided
  const volume = params.volume || calculateVolumeFromBudget(params.budget!);

  // Check leverage
  if (params.leverage < 1 || params.leverage > 20) {
    errors.push('Leverage must be between 1x and 20x');
  }

  // Check directional bias
  if (params.directionalBias < -1 || params.directionalBias > 1) {
    errors.push('Directional bias must be between -1 and +1');
  }

  // Check margin
  const requiredMargin = calculateRequiredMargin({
    volume,
    leverage: params.leverage,
    executionMode: params.executionMode,
    directionalBias: params.directionalBias,
  });

  if (requiredMargin > params.availableMargin) {
    errors.push(
      `Insufficient margin: ${requiredMargin.toFixed(2)} USDC required, ${params.availableMargin.toFixed(2)} available`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
