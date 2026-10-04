// zod → JSON Schema 转换器（VAP 工具参数描述；MCP tools/list 与 LLM providers 直接消费）
// 支持子集：z.object / z.string / z.number / z.boolean / z.literal / z.enum / z.array /
//          z.record / z.optional / z.union(string|number) / z.default / z.nullable + .describe()
// 不引入 zod-to-json-schema 依赖：我们的工具 schema 是受控子集，手写转换器行为可测、输出稳定。
import { z } from "zod";

type JsonSchemaObject = Record<string, unknown>;

/** zod 内部 _def.typeName 判别（zod 3.x） */
function defType(schema: z.ZodTypeAny): string {
  return (schema._def as { typeName?: string }).typeName ?? "";
}

function hasIntCheck(schema: z.ZodNumber): boolean {
  const checks = (schema._def as { checks?: Array<{ kind?: string }> }).checks ?? [];
  return checks.some((c) => c.kind === "int");
}

/** 数值检查提取 min/max（若工具 schema 声明了约束则透传给 LLM） */
function numberBounds(schema: z.ZodNumber): JsonSchemaObject {
  const out: JsonSchemaObject = {};
  const checks = (schema._def as { checks?: Array<{ kind?: string; value?: number }> }).checks ?? [];
  for (const c of checks) {
    if (c.kind === "min") out.minimum = c.value;
    if (c.kind === "max") out.maximum = c.value;
  }
  return out;
}

/** 递归转换；unsupported 遇到不认识的 schema 抛错（宁可失败也不要给 LLM 错误的契约） */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchemaObject {
  const type = defType(schema);
  const description = typeof schema.description === "string" && schema.description.length > 0
    ? { description: schema.description }
    : {};

  switch (type) {
    case "ZodString":
      return { type: "string", ...description };

    case "ZodNumber": {
      const number = schema as z.ZodNumber;
      return { type: hasIntCheck(number) ? "integer" : "number", ...numberBounds(number), ...description };
    }

    case "ZodBoolean":
      return { type: "boolean", ...description };

    case "ZodLiteral": {
      const value = (schema._def as { value: unknown }).value;
      const jsonType = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
      return { type: jsonType, const: value, ...description };
    }

    case "ZodEnum": {
      const values = (schema._def as { values: string[] }).values;
      return { type: "string", enum: [...values], ...description };
    }

    case "ZodArray": {
      const inner = (schema._def as { type: z.ZodTypeAny }).type;
      return { type: "array", items: zodToJsonSchema(inner), ...description };
    }

    case "ZodRecord": {
      const def = schema._def as { keyType: z.ZodTypeAny; valueType: z.ZodTypeAny };
      return { type: "object", additionalProperties: zodToJsonSchema(def.valueType), ...description };
    }

    case "ZodObject": {
      // zod 3.x：ZodObject.shape 是属性（shape 对象），_def.shape() 是函数 —— 两者都取键→schema 映射
      const def = schema._def as { shape(): Record<string, z.ZodTypeAny> };
      const shape = typeof (schema as { shape?: unknown }).shape === "object"
        ? (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape
        : def.shape();
      const properties: JsonSchemaObject = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        if (defType(value) !== "ZodOptional" && defType(value) !== "ZodDefault") required.push(key);
      }
      return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        ...description,
      };
    }

    case "ZodOptional":
    case "ZodDefault": {
      const inner = (schema._def as { innerType: z.ZodTypeAny }).innerType;
      return zodToJsonSchema(inner);
    }

    case "ZodNullable": {
      const inner = (schema._def as { innerType: z.ZodTypeAny }).innerType;
      const converted = zodToJsonSchema(inner);
      if (typeof converted.type === "string") return { ...converted, type: [converted.type, "null"] };
      return converted;
    }

    case "ZodUnion": {
      const options = (schema._def as { options: z.ZodTypeAny[] }).options;
      return { anyOf: options.map((o) => zodToJsonSchema(o)), ...description };
    }

    default:
      throw new Error(
        `zodToJsonSchema: unsupported zod type "${type || "<unknown>"}" (supported: object/string/number/boolean/literal/enum/array/record/optional/default/nullable/union)`,
      );
  }
}
