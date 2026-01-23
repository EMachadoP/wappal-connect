/**
 * Centralized Logging Utility for Supabase Edge Functions
 * 
 * Provides standardized logging with correlation IDs for request tracing
 */

import { createClient } from "npm:@supabase/supabase-js@2.92.0";

export interface LogContext {
    correlationId?: string;
    conversationId?: string;
    contactId?: string;
    userId?: string;
    functionName: string;
    [key: string]: any;
}

export interface LogEntry {
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
    context: LogContext;
    timestamp: string;
    error?: Error;
    metadata?: Record<string, any>;
}

export class Logger {
    private supabase: any;
    private context: LogContext;

    constructor(supabaseUrl: string, supabaseKey: string, context: LogContext) {
        this.supabase = createClient(supabaseUrl, supabaseKey);
        this.context = {
            ...context,
            correlationId: context.correlationId || this.generateCorrelationId(),
        };
    }

    private generateCorrelationId(): string {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    }

    private formatMessage(level: string, message: string, metadata?: any): string {
        const prefix = `[${level.toUpperCase()}][${this.context.functionName}][${this.context.correlationId}]`;
        const metaStr = metadata ? ` | ${JSON.stringify(metadata)}` : '';
        return `${prefix} ${message}${metaStr}`;
    }

    debug(message: string, metadata?: Record<string, any>) {
        console.log(this.formatMessage('debug', message, metadata));
    }

    info(message: string, metadata?: Record<string, any>) {
        console.log(this.formatMessage('info', message, metadata));
    }

    warn(message: string, metadata?: Record<string, any>) {
        console.warn(this.formatMessage('warn', message, metadata));
    }

    async error(message: string, error?: Error, metadata?: Record<string, any>) {
        console.error(this.formatMessage('error', message, metadata), error);

        // Log to ai_logs table
        try {
            await this.supabase.from('ai_logs').insert({
                conversation_id: this.context.conversationId || null,
                status: 'error',
                error_message: `${message}${error ? ': ' + error.message : ''}`,
                provider: 'internal',
                model: this.context.functionName,
                request_id: this.context.correlationId,
                input_excerpt: JSON.stringify({
                    ...this.context,
                    ...metadata,
                }).substring(0, 500),
            });
        } catch (logError) {
            console.error('[Logger] Failed to write to ai_logs:', logError);
        }
    }

    async logFunctionCall(
        functionName: string,
        status: 'success' | 'error',
        metadata?: Record<string, any>
    ) {
        try {
            await this.supabase.from('ai_logs').insert({
                conversation_id: this.context.conversationId || null,
                status: status === 'success' ? 'completed' : 'error',
                provider: 'internal',
                model: functionName,
                request_id: this.context.correlationId,
                input_excerpt: JSON.stringify(metadata || {}).substring(0, 500),
            });
        } catch (error) {
            console.error('[Logger] Failed to log function call:', error);
        }
    }

    getCorrelationId(): string {
        return this.context.correlationId!;
    }

    getContext(): LogContext {
        return { ...this.context };
    }

    withContext(additionalContext: Partial<LogContext>): Logger {
        return new Logger(
            this.supabase.supabaseUrl,
            this.supabase.supabaseKey,
            { ...this.context, ...additionalContext }
        );
    }
}

/**
 * Extract correlation ID from request headers or generate new one
 */
export function getCorrelationId(req: Request): string {
    const headerCorrelationId = req.headers.get('x-correlation-id');
    if (headerCorrelationId) return headerCorrelationId;

    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Create logger instance for Edge Function
 */
export function createLogger(
    req: Request,
    functionName: string,
    supabaseUrl: string,
    supabaseKey: string,
    additionalContext?: Partial<LogContext>
): Logger {
    const correlationId = getCorrelationId(req);

    return new Logger(supabaseUrl, supabaseKey, {
        correlationId,
        functionName,
        ...additionalContext,
    });
}
