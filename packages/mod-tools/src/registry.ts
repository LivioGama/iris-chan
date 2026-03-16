export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export interface ToolResult {
  ok: boolean;
  result: unknown;
  durationMs?: number;
  [key: string]: unknown;
}

interface RegisteredTool {
  declaration: ToolDeclaration;
  handler: ToolHandler;
  source: string; // module that registered it
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(
    declaration: ToolDeclaration,
    handler: ToolHandler,
    source: string,
  ): void {
    if (this.tools.has(declaration.name)) {
      console.warn(
        `[tools] Overwriting tool "${declaration.name}" (was: ${this.tools.get(declaration.name)!.source}, now: ${source})`,
      );
    }
    this.tools.set(declaration.name, { declaration, handler, source });
  }

  unregisterBySource(source: string): void {
    for (const [name, tool] of this.tools) {
      if (tool.source === source) {
        this.tools.delete(name);
      }
    }
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getDeclarations(): ToolDeclaration[] {
    return Array.from(this.tools.values()).map((t) => t.declaration);
  }

  list(): Array<{ name: string; description: string; source: string }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.declaration.name,
      description: t.declaration.description,
      source: t.source,
    }));
  }

  get size(): number {
    return this.tools.size;
  }
}
