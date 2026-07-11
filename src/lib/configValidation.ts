export type ConfigIssue = {
  severity: "error" | "warning";
  line: number;
  message: string;
  path?: string;
};
const PIN =
  /^(NO_PIN|no_pin|void|gpio\.\d+|i2so\.\d+|uart_channel\d+\.\d+)(:(high|low|pu|pd|ds[0-3]))*$/i;

export function validateFluidConfig(source: string): ConfigIssue[] {
  const issues: ConfigIssue[] = [],
    lines = source.split("\n");
  const stack: { indent: number; key: string }[] = [],
    siblingIndents = new Map<string, number>();
  const pins = new Map<string, { line: number; path: string }>(),
    values = new Map<string, { value: string; line: number }>();
  if (!source.trim())
    issues.push({
      severity: "error",
      line: 1,
      message: "Configuration is empty.",
    });
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (raw.includes("\t"))
      issues.push({
        severity: "error",
        line,
        message: "Tabs are not allowed; use spaces.",
      });
    if (/^\s*[^#\n]+:\s*[^#\n]+\s+#/.test(raw))
      issues.push({
        severity: "error",
        line,
        message: "Inline comments are not supported by FluidNC.",
      });
    if (/^\s*---\s*$|:\s*[\[{]/.test(raw))
      issues.push({
        severity: "error",
        line,
        message: "Unsupported YAML feature; use block-style FluidNC YAML.",
      });
    if (!raw.trim() || raw.trimStart().startsWith("#")) return;
    const match = raw.match(/^(\s*)([^:#]+):(?:\s*(.*))?$/);
    if (!match) {
      issues.push({
        severity: "error",
        line,
        message: "Expected a key followed by a colon.",
      });
      return;
    }
    const indent = match[1].length,
      key = match[2].trim(),
      value = (match[3] ?? "").trim().replace(/^(['"])(.*)\1$/, "$2");
    while (stack.length && stack[stack.length - 1].indent >= indent)
      stack.pop();
    const parent = stack.map((item) => item.key).join("."),
      path = parent ? `${parent}.${key}` : key;
    const knownIndent = siblingIndents.get(parent);
    if (knownIndent == null) siblingIndents.set(parent, indent);
    else if (knownIndent !== indent)
      issues.push({
        severity: "error",
        line,
        path,
        message: `Inconsistent indentation under ${parent || "the document root"}.`,
      });
    if (!value) {
      stack.push({ indent, key });
      return;
    }
    values.set(path, { value, line });
    if (/_pin$|\.pin$/.test(path)) {
      if (!PIN.test(value))
        issues.push({
          severity: "error",
          line,
          path,
          message: `Invalid FluidNC pin: ${value}`,
        });
      const base = value.split(":")[0].toLowerCase();
      if (base !== "no_pin" && base !== "void") {
        const previous = pins.get(base);
        if (previous)
          issues.push({
            severity: "error",
            line,
            path,
            message: `${base} is already used on line ${previous.line} (${previous.path}).`,
          });
        else pins.set(base, { line, path });
      }
    }
    if (
      !/^(true|false)$/i.test(value) &&
      /(^|\.)(soft_limits|hard_limits|positive_direction|enable|enabled|must_home|check_limits|use_enable|off_on_alarm)$/.test(
        path,
      )
    )
      issues.push({
        severity: "error",
        line,
        path,
        message: "Boolean values must be exactly true or false.",
      });
  });
  for (const axis of ["x", "y", "z", "a", "b", "c"])
    for (const motor of ["motor0", "motor1"]) {
      const prefix = `axes.${axis}.${motor}`,
        driverField = [...values.keys()].find(
          (path) =>
            path.startsWith(`${prefix}.`) &&
            /\.(stepstick|standard_stepper|tmc_\d+|servo)\./.test(path),
        );
      if (!driverField) continue;
      const driver = driverField.slice(0, driverField.lastIndexOf("."));
      for (const field of ["step_pin", "direction_pin"]) {
        const entry = values.get(`${driver}.${field}`);
        if (!entry || /^(NO_PIN|no_pin)$/i.test(entry.value))
          issues.push({
            severity: "error",
            line: entry?.line ?? values.get(driverField)?.line ?? 1,
            path: `${driver}.${field}`,
            message: `${axis.toUpperCase()} ${motor} requires a ${field.replace("_", " ")}.`,
          });
      }
    }
  if (![...values.keys()].some((path) => /^axes\.[xyzabc]\./.test(path)))
    issues.push({
      severity: "warning",
      line: 1,
      path: "axes",
      message: "No configured axes were found.",
    });
  return issues.sort(
    (a, b) => a.line - b.line || (a.severity === "error" ? -1 : 1),
  );
}
