import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  CircuitBoard,
  Cpu,
  Crosshair,
  Gauge,
  GitBranch,
  Grid3X3,
  Minus,
  MousePointer2,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Zap,
} from "lucide-react";

type NodeKind =
  | "machine"
  | "stepping"
  | "axes"
  | "axis"
  | "motor"
  | "kinematics"
  | "spindle"
  | "bus"
  | "storage"
  | "control"
  | "probe"
  | "coolant"
  | "macro"
  | "io"
  | "parking"
  | "display"
  | "atc";
type NodeData = {
  id: string;
  kind: NodeKind;
  title: string;
  subtitle: string;
  x: number;
  y: number;
  color: string;
  fields: Record<string, string>;
  parentId?: string;
};
type FieldDef = {
  key: string;
  label: string;
  type?: "number" | "boolean" | "select" | "pin" | "text";
  options?: string[];
  unit?: string;
};

const PALETTE: {
  group: string;
  items: { kind: NodeKind; title: string; sub: string }[];
}[] = [
  {
    group: "Motion",
    items: [
      { kind: "axis", title: "Axis", sub: "X, Y, Z, A, B or C" },
      { kind: "motor", title: "Motor", sub: "StepStick, TMC, servo" },
      {
        kind: "kinematics",
        title: "Kinematics",
        sub: "Cartesian, CoreXY, Delta",
      },
    ],
  },
  {
    group: "Tooling",
    items: [
      {
        kind: "spindle",
        title: "Spindle / Laser",
        sub: "PWM, VFD, relay, plasma",
      },
      { kind: "probe", title: "Probe", sub: "Touch probe input" },
      { kind: "atc", title: "Tool changer", sub: "Manual ATC workflow" },
      { kind: "coolant", title: "Coolant", sub: "Flood and mist outputs" },
    ],
  },
  {
    group: "Hardware",
    items: [
      { kind: "bus", title: "Hardware bus", sub: "UART, SPI, I²C, I²S" },
      { kind: "storage", title: "SD card", sub: "SPI storage interface" },
      { kind: "io", title: "User I/O", sub: "Digital and analog I/O" },
      { kind: "display", title: "OLED display", sub: "I²C status display" },
    ],
  },
  {
    group: "Machine",
    items: [
      {
        kind: "control",
        title: "Control inputs",
        sub: "Reset, hold, start, E-stop",
      },
      {
        kind: "parking",
        title: "Startup & parking",
        sub: "Homing and safety-door motion",
      },
      { kind: "macro", title: "Macros", sub: "Startup and event commands" },
    ],
  },
];

const FIELDS: Record<NodeKind, FieldDef[]> = {
  machine: [
    { key: "name", label: "Machine name" },
    { key: "board", label: "Board" },
    { key: "meta", label: "Description" },
  ],
  stepping: [
    {
      key: "engine",
      label: "Engine",
      type: "select",
      options: ["RMT", "TIMED", "I2S_STATIC", "I2S_STREAM"],
    },
    { key: "idle_ms", label: "Idle delay", type: "number", unit: "ms" },
    { key: "pulse_us", label: "Pulse width", type: "number", unit: "µs" },
    {
      key: "dir_delay_us",
      label: "Direction delay",
      type: "number",
      unit: "µs",
    },
    {
      key: "disable_delay_us",
      label: "Disable delay",
      type: "number",
      unit: "µs",
    },
  ],
  axes: [
    {
      key: "shared_stepper_disable_pin",
      label: "Shared stepper disable",
      type: "pin",
    },
  ],
  axis: [
    {
      key: "axis",
      label: "Axis",
      type: "select",
      options: ["x", "y", "z", "a", "b", "c"],
    },
    { key: "steps_per_mm", label: "Steps per mm", type: "number" },
    {
      key: "max_rate_mm_per_min",
      label: "Maximum rate",
      type: "number",
      unit: "mm/min",
    },
    {
      key: "acceleration_mm_per_sec2",
      label: "Acceleration",
      type: "number",
      unit: "mm/s²",
    },
    {
      key: "max_travel_mm",
      label: "Maximum travel",
      type: "number",
      unit: "mm",
    },
    { key: "soft_limits", label: "Soft limits", type: "boolean" },
    { key: "homing_cycle", label: "Homing cycle", type: "number" },
    { key: "homing_positive", label: "Positive homing", type: "boolean" },
    {
      key: "homing_mpos_mm",
      label: "Home position",
      type: "number",
      unit: "mm",
    },
  ],
  motor: [
    {
      key: "driver",
      label: "Driver",
      type: "select",
      options: [
        "stepstick",
        "tmc_2130",
        "tmc_2208",
        "tmc_2209",
        "tmc_5160",
        "servo",
        "standard_stepper",
        "null_motor",
      ],
    },
    { key: "step_pin", label: "Step pin", type: "pin" },
    { key: "direction_pin", label: "Direction pin", type: "pin" },
    { key: "disable_pin", label: "Disable pin", type: "pin" },
    { key: "limit_neg_pin", label: "Negative limit", type: "pin" },
    { key: "limit_pos_pin", label: "Positive limit", type: "pin" },
    { key: "limit_all_pin", label: "Combined limit", type: "pin" },
    { key: "hard_limits", label: "Hard limits", type: "boolean" },
    { key: "pulloff_mm", label: "Pull-off", type: "number", unit: "mm" },
    { key: "run_amps", label: "Run current", type: "number", unit: "A" },
    { key: "hold_amps", label: "Hold current", type: "number", unit: "A" },
    { key: "microsteps", label: "Microsteps", type: "number" },
    { key: "uart_num", label: "UART bus", type: "number" },
    { key: "addr", label: "Driver address", type: "number" },
  ],
  kinematics: [
    {
      key: "type",
      label: "Type",
      type: "select",
      options: [
        "Cartesian",
        "CoreXY",
        "midtbot",
        "parallel_delta",
        "WallPlotter",
      ],
    },
    {
      key: "kinematic_segment_len_mm",
      label: "Segment length",
      type: "number",
      unit: "mm",
    },
  ],
  spindle: [
    {
      key: "type",
      label: "Spindle type",
      type: "select",
      options: [
        "PWM",
        "10V",
        "DAC",
        "HBridge",
        "Laser",
        "Relay",
        "OnOff",
        "BESC",
        "PlasmaSpindle",
        "NoSpindle",
        "ModbusVFD",
        "Huanyang",
        "H2A",
        "YL620",
        "DeltaMS300",
        "FolinnBD600",
        "H100",
        "MollomG70",
        "NowForever",
        "SiemensV20",
        "DanfossVLT2800",
      ],
    },
    { key: "tool_num", label: "Tool number", type: "number" },
    { key: "output_pin", label: "Output pin", type: "pin" },
    { key: "enable_pin", label: "Enable pin", type: "pin" },
    { key: "direction_pin", label: "Direction pin", type: "pin" },
    { key: "pwm_hz", label: "PWM frequency", type: "number", unit: "Hz" },
    { key: "speed_map", label: "Speed map" },
    { key: "spinup_ms", label: "Spin-up delay", type: "number", unit: "ms" },
    {
      key: "spindown_ms",
      label: "Spin-down delay",
      type: "number",
      unit: "ms",
    },
    { key: "uart_num", label: "UART bus", type: "number" },
    { key: "modbus_id", label: "Modbus ID", type: "number" },
  ],
  bus: [
    {
      key: "type",
      label: "Bus type",
      type: "select",
      options: ["uart1", "uart2", "i2c0", "i2c1", "spi", "i2so"],
    },
    { key: "txd_pin", label: "TX pin", type: "pin" },
    { key: "rxd_pin", label: "RX pin", type: "pin" },
    { key: "sda_pin", label: "SDA pin", type: "pin" },
    { key: "scl_pin", label: "SCL pin", type: "pin" },
    { key: "sck_pin", label: "Clock pin", type: "pin" },
    { key: "mosi_pin", label: "MOSI pin", type: "pin" },
    { key: "miso_pin", label: "MISO pin", type: "pin" },
    { key: "baud", label: "Baud rate", type: "number" },
    { key: "frequency", label: "Frequency", type: "number", unit: "Hz" },
  ],
  storage: [
    { key: "cs_pin", label: "Chip select", type: "pin" },
    { key: "card_detect_pin", label: "Card detect", type: "pin" },
    { key: "frequency_hz", label: "Frequency", type: "number", unit: "Hz" },
  ],
  control: [
    { key: "reset_pin", label: "Reset", type: "pin" },
    { key: "feed_hold_pin", label: "Feed hold", type: "pin" },
    { key: "cycle_start_pin", label: "Cycle start", type: "pin" },
    { key: "safety_door_pin", label: "Safety door", type: "pin" },
    { key: "estop_pin", label: "Emergency stop", type: "pin" },
    { key: "fault_pin", label: "Fault", type: "pin" },
  ],
  probe: [
    { key: "pin", label: "Probe pin", type: "pin" },
    { key: "toolsetter_pin", label: "Tool setter pin", type: "pin" },
    { key: "check_mode_start", label: "Allow check mode", type: "boolean" },
  ],
  coolant: [
    { key: "flood_pin", label: "Flood pin", type: "pin" },
    { key: "mist_pin", label: "Mist pin", type: "pin" },
    { key: "delay_ms", label: "Delay", type: "number", unit: "ms" },
  ],
  macro: [
    { key: "startup_line0", label: "Startup line 0" },
    { key: "startup_line1", label: "Startup line 1" },
    { key: "after_homing", label: "After homing" },
    { key: "macro0", label: "Macro 0" },
    { key: "macro1", label: "Macro 1" },
    { key: "macro2", label: "Macro 2" },
    { key: "macro3", label: "Macro 3" },
  ],
  io: [
    ...Array.from({ length: 8 }, (_, i) => ({
      key: `digital${i}_pin`,
      label: `Digital ${i}`,
      type: "pin" as const,
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      key: `analog${i}_pin`,
      label: `Analog ${i}`,
      type: "pin" as const,
    })),
  ],
  parking: [
    { key: "must_home", label: "Must home", type: "boolean" },
    { key: "check_limits", label: "Check limits at boot", type: "boolean" },
    { key: "enable", label: "Parking enabled", type: "boolean" },
    {
      key: "axis",
      label: "Parking axis",
      type: "select",
      options: ["x", "y", "z", "a", "b", "c"],
    },
    {
      key: "target_mpos_mm",
      label: "Parking position",
      type: "number",
      unit: "mm",
    },
    {
      key: "rate_mm_per_min",
      label: "Parking rate",
      type: "number",
      unit: "mm/min",
    },
  ],
  display: [
    { key: "i2c_num", label: "I²C bus", type: "number" },
    { key: "i2c_address", label: "Address (decimal)", type: "number" },
    { key: "width", label: "Width", type: "number", unit: "px" },
    { key: "height", label: "Height", type: "number", unit: "px" },
    { key: "flip", label: "Flip", type: "boolean" },
    { key: "mirror", label: "Mirror", type: "boolean" },
  ],
  atc: [
    { key: "safe_z_mpos_mm", label: "Safe Z", type: "number", unit: "mm" },
    {
      key: "probe_seek_rate_mm_per_min",
      label: "Probe seek rate",
      type: "number",
      unit: "mm/min",
    },
    {
      key: "probe_feed_rate_mm_per_min",
      label: "Probe feed rate",
      type: "number",
      unit: "mm/min",
    },
    { key: "change_mpos_mm", label: "Change position array" },
    { key: "ets_mpos_mm", label: "Tool setter position array" },
  ],
};

const COLORS: Record<NodeKind, string> = {
  machine: "#7c8ba1",
  stepping: "#d6943b",
  axes: "#438bc8",
  axis: "#4f8edc",
  motor: "#6f7fd5",
  kinematics: "#5ba5a4",
  spindle: "#dc7659",
  bus: "#9c72c2",
  storage: "#8a78b0",
  control: "#d05265",
  probe: "#47a986",
  coolant: "#42a7ba",
  macro: "#a47851",
  io: "#4e9f83",
  parking: "#b47b48",
  display: "#458fa8",
  atc: "#bf675b",
};
const HUB_PARTITIONS = [
  {
    id: "tooling",
    label: "Tooling",
    color: "#dc7659",
    direction: "left" as const,
    kinds: ["spindle", "probe", "coolant", "atc"] as NodeKind[],
    add: "spindle" as NodeKind,
  },
  {
    id: "motion",
    label: "Motion",
    color: "#4f8edc",
    direction: "right" as const,
    kinds: ["stepping", "axes", "kinematics"] as NodeKind[],
    add: "kinematics" as NodeKind,
  },
  {
    id: "hardware",
    label: "Hardware",
    color: "#9c72c2",
    direction: "bottom" as const,
    kinds: ["bus", "storage", "io", "display"] as NodeKind[],
    add: "bus" as NodeKind,
  },
  {
    id: "safety",
    label: "Safety & automation",
    color: "#47a986",
    direction: "right" as const,
    kinds: ["control", "parking", "macro"] as NodeKind[],
    add: "control" as NodeKind,
  },
];
const hubPartition = (kind: NodeKind) =>
  HUB_PARTITIONS.findIndex((p) => p.kinds.includes(kind));
const CHILDREN: Partial<Record<NodeKind, { kind: NodeKind; title: string }[]>> =
  {
    axes: [{ kind: "axis", title: "Axis" }],
    axis: [{ kind: "motor", title: "Motor" }],
    bus: [
      { kind: "storage", title: "SD card" },
      { kind: "display", title: "OLED display" },
    ],
    spindle: [{ kind: "atc", title: "Tool changer" }],
  };
const ROOT_OPTIONS: Record<
  string,
  { kind: NodeKind; title: string; repeatable?: boolean }[]
> = {
  tooling: [
    { kind: "spindle", title: "Spindle / Laser", repeatable: true },
    { kind: "probe", title: "Probe" },
    { kind: "coolant", title: "Coolant" },
    { kind: "atc", title: "Tool changer" },
  ],
  motion: [
    { kind: "stepping", title: "Stepping" },
    { kind: "axes", title: "Axes" },
    { kind: "kinematics", title: "Kinematics" },
  ],
  hardware: [
    { kind: "bus", title: "Hardware bus", repeatable: true },
    { kind: "storage", title: "SD card" },
    { kind: "io", title: "User inputs", repeatable: true },
    { kind: "io", title: "User outputs", repeatable: true },
    { kind: "display", title: "OLED display" },
  ],
  safety: [
    { kind: "control", title: "Control inputs" },
    { kind: "parking", title: "Startup & parking" },
    { kind: "macro", title: "Macros" },
  ],
};
const PARTITION_ORIGINS = {
  tooling: { x: 80, y: 290, dx: 0, dy: 125 },
  motion: { x: 830, y: 230, dx: 0, dy: 135 },
  hardware: { x: 360, y: 760, dx: 245, dy: 0 },
  safety: { x: 830, y: 650, dx: 0, dy: 125 },
} as const;
const defaults = (kind: NodeKind): Record<string, string> =>
  Object.fromEntries(
    FIELDS[kind].map((f) => [
      f.key,
      f.type === "boolean"
        ? "false"
        : f.type === "pin"
          ? "NO_PIN"
          : (f.options?.[0] ?? ""),
    ]),
  );

function defaultNodes(): NodeData[] {
  return layoutNodes([
    {
      id: "machine",
      kind: "machine",
      title: "Machine",
      subtitle: "FluidNC configuration",
      x: 40,
      y: 170,
      color: COLORS.machine,
      fields: { name: "My CNC", board: "ESP32 controller", meta: "" },
    },
    {
      id: "stepping",
      kind: "stepping",
      title: "Stepping",
      subtitle: "RMT · 4 µs pulse",
      x: 330,
      y: 40,
      color: COLORS.stepping,
      fields: {
        ...defaults("stepping"),
        engine: "RMT",
        idle_ms: "255",
        pulse_us: "4",
      },
    },
    {
      id: "axes",
      kind: "axes",
      title: "Axes",
      subtitle: "Shared axis configuration",
      x: 330,
      y: 170,
      color: COLORS.axes,
      fields: defaults("axes"),
    },
    ...["X", "Y", "Z"].flatMap((a, i) => [
      {
        id: `axis-${a}`,
        kind: "axis" as const,
        title: `${a} Axis`,
        subtitle: "Motion axis",
        x: 620,
        y: 100 + i * 180,
        color: COLORS.axis,
        parentId: "axes",
        fields: {
          ...defaults("axis"),
          axis: a.toLowerCase(),
          steps_per_mm: a === "Z" ? "400" : "80",
          max_rate_mm_per_min: a === "Z" ? "1000" : "3000",
          acceleration_mm_per_sec2: "100",
          max_travel_mm: a === "Z" ? "80" : "300",
        },
      },
      {
        id: `axis-${a}-motor0`,
        kind: "motor" as const,
        title: `${a} Motor 0`,
        subtitle: "stepstick · pins not assigned",
        x: 910,
        y: 100 + i * 180,
        color: COLORS.motor,
        parentId: `axis-${a}`,
        fields: { ...defaults("motor"), driver: "stepstick" },
      },
    ]),
  ]);
}

function layoutNodes(source: NodeData[]): NodeData[] {
  const nodes = source.map((node) => ({ ...node }));
  const machine = nodes.find((node) => node.kind === "machine");
  if (!machine) return nodes;
  machine.x = 470;
  machine.y = 360;
  for (const partition of HUB_PARTITIONS) {
    const rootNodes = nodes.filter(
      (node) => !node.parentId && partition.kinds.includes(node.kind),
    );
    const origin =
      PARTITION_ORIGINS[partition.id as keyof typeof PARTITION_ORIGINS];
    rootNodes.forEach((node, index) => {
      node.x = origin.x + origin.dx * index;
      node.y = origin.y + origin.dy * index;
      layoutChildren(nodes, node, partition.direction);
    });
  }
  return nodes;
}

function layoutChildren(
  nodes: NodeData[],
  parent: NodeData,
  direction: "right" | "left" | "top" | "bottom",
) {
  const children = nodes.filter((node) => node.parentId === parent.id);
  children.forEach((node, index) => {
    if (direction === "right" || direction === "left") {
      node.x = parent.x + (direction === "right" ? 290 : -290);
      node.y = parent.y + (index - (children.length - 1) / 2) * 115;
    } else {
      node.x = parent.x + (index - (children.length - 1) / 2) * 245;
      node.y = parent.y + (direction === "bottom" ? 125 : -125);
    }
    layoutChildren(nodes, node, direction);
  });
}

function branchDirection(nodes: NodeData[], node: NodeData) {
  let root = node;
  while (root.parentId)
    root = nodes.find((candidate) => candidate.id === root.parentId) ?? root;
  return HUB_PARTITIONS[Math.max(0, hubPartition(root.kind))].direction;
}

function scalarFields(source: unknown, defs: FieldDef[]) {
  const obj = (source && typeof source === "object" ? source : {}) as Record<
    string,
    unknown
  >;
  return Object.fromEntries(
    defs.map((f) => [
      f.key,
      obj[f.key] == null
        ? f.type === "boolean"
          ? "false"
          : f.type === "pin"
            ? "NO_PIN"
            : (f.options?.[0] ?? "")
        : String(obj[f.key]),
    ]),
  );
}

function parseConfig(content: string): Record<string, any> {
  const root: Record<string, any> = {};
  const stack: { indent: number; value: Record<string, any> }[] = [
    { indent: -1, value: root },
  ];
  for (const raw of content.split("\n")) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const match = raw.match(/^(\s*)([^:#]+):(?:\s*(.*))?$/);
    if (!match) continue;
    const indent = match[1].length,
      key = match[2].trim(),
      token = (match[3] ?? "").trim();
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent)
      stack.pop();
    const parent = stack[stack.length - 1].value;
    if (!token) {
      const child: Record<string, any> = {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      const clean = token.replace(/^(['"])(.*)\1$/, "$2");
      parent[key] =
        clean === "true"
          ? true
          : clean === "false"
            ? false
            : /^-?\d+(?:\.\d+)?$/.test(clean)
              ? Number(clean)
              : clean;
    }
  }
  return root;
}

function nodesFromYaml(content: string): NodeData[] {
  if (!content.trim()) return defaultNodes();
  try {
    const root = parseConfig(content);
    const nodes: NodeData[] = [
      {
        id: "machine",
        kind: "machine",
        title: "Machine",
        subtitle: "FluidNC configuration",
        x: 40,
        y: 220,
        color: COLORS.machine,
        fields: { ...scalarFields(root, FIELDS.machine) },
      },
    ];
    if (root.stepping)
      nodes.push({
        id: "stepping",
        kind: "stepping",
        title: "Stepping",
        subtitle: `${root.stepping.engine ?? "RMT"} stepping engine`,
        x: 330,
        y: 40,
        color: COLORS.stepping,
        fields: scalarFields(root.stepping, FIELDS.stepping),
      });
    const axes = root.axes && typeof root.axes === "object" ? root.axes : {};
    nodes.push({
      id: "axes",
      kind: "axes",
      title: "Axes",
      subtitle: "Shared axis configuration",
      x: 330,
      y: 190,
      color: COLORS.axes,
      fields: scalarFields(axes, FIELDS.axes),
    });
    Object.entries(axes)
      .filter(([letter]) => /^[xyzabc]$/i.test(letter))
      .forEach(([letter, value], i) => {
        const axis = value as Record<string, any>,
          axisId = `axis-${letter.toUpperCase()}`;
        const fields: Record<string, string> = {
          ...scalarFields(axis, FIELDS.axis),
          axis: letter,
        };
        if (axis.homing) {
          fields.homing_cycle = String(axis.homing.cycle ?? "");
          fields.homing_positive = String(
            axis.homing.positive_direction ?? false,
          );
          fields.homing_mpos_mm = String(axis.homing.mpos_mm ?? "");
        }
        nodes.push({
          id: axisId,
          kind: "axis",
          title: `${letter.toUpperCase()} Axis`,
          subtitle: "Motion axis",
          x: 620,
          y: 90 + i * 190,
          color: COLORS.axis,
          parentId: "axes",
          fields,
        });
        ["motor0", "motor1"].forEach((motorKey, motorIndex) => {
          if (!axis[motorKey]) return;
          const motor = axis[motorKey] as Record<string, any>;
          const driver =
            Object.keys(motor).find((k) =>
              [
                "stepstick",
                "tmc_2130",
                "tmc_2208",
                "tmc_2209",
                "tmc_5160",
                "servo",
                "standard_stepper",
                "null_motor",
              ].includes(k),
            ) ?? "stepstick";
          const driverFields =
            motor[driver] && typeof motor[driver] === "object"
              ? motor[driver]
              : {};
          nodes.push({
            id: `${axisId}-${motorKey}`,
            kind: "motor",
            title: `${letter.toUpperCase()} Motor ${motorIndex}`,
            subtitle: `${driver} · configured`,
            x: 910 + motorIndex * 250,
            y: 90 + i * 190 + motorIndex * 80,
            color: COLORS.motor,
            parentId: axisId,
            fields: {
              ...scalarFields({ ...motor, ...driverFields }, FIELDS.motor),
              driver,
            },
          });
        });
      });
    const sectionKinds: [string, NodeKind, string][] = [
      ["control", "control", "Control inputs"],
      ["probe", "probe", "Probe"],
      ["coolant", "coolant", "Coolant"],
      ["macros", "macro", "Macros"],
      ["parking", "parking", "Startup & parking"],
      ["oled", "display", "OLED display"],
      ["atc_manual", "atc", "Tool changer"],
      ["sdcard", "storage", "SD card"],
      ["user_inputs", "io", "User inputs"],
      ["user_outputs", "io", "User outputs"],
    ];
    sectionKinds.forEach(([key, kind, title], i) => {
      if (root[key] != null)
        nodes.push({
          id: `${kind}-${i}`,
          kind,
          title,
          subtitle: "Loaded from config.yaml",
          x: 920 + (i % 2) * 240,
          y: 80 + (i % 5) * 135,
          color: COLORS[kind],
          fields: scalarFields(root[key], FIELDS[kind]),
        });
    });
    Object.entries(root).forEach(([key, value], i) => {
      if (/^uart\d+$|^i2c\d+$|^(spi|i2so)$/.test(key))
        nodes.push({
          id: `bus-${key}`,
          kind: "bus",
          title: key.toUpperCase(),
          subtitle: "Hardware bus",
          x: 1180,
          y: 80 + i * 90,
          color: COLORS.bus,
          fields: { ...scalarFields(value, FIELDS.bus), type: key },
        });
    });
    const spindleTypes = FIELDS.spindle[0].options ?? [];
    for (const type of spindleTypes) {
      if (root[type] != null)
        nodes.push({
          id: `spindle-${type}`,
          kind: "spindle",
          title: type,
          subtitle: "Spindle / tool output",
          x: 920,
          y: 580,
          color: COLORS.spindle,
          fields: { ...scalarFields(root[type], FIELDS.spindle), type },
        });
    }
    return nodes.length > 1 ? layoutNodes(nodes) : defaultNodes();
  } catch {
    return defaultNodes();
  }
}

function PinEditor({
  value,
  onChange,
  hasI2so,
  uartChannels,
}: {
  value: string;
  onChange: (v: string) => void;
  hasI2so: boolean;
  uartChannels: string[];
}) {
  const parts = value.split(":");
  const base = parts[0];
  const dot = base.lastIndexOf(".");
  const family =
    base === "NO_PIN"
      ? "NO_PIN"
      : base === "void"
        ? "void"
        : dot > 0
          ? base.slice(0, dot)
          : "gpio";
  const index = dot > 0 ? base.slice(dot + 1) : "0";
  const set = (nextFamily: string, nextIndex = index, attrs = parts.slice(1)) =>
    onChange(
      nextFamily === "NO_PIN" || nextFamily === "void"
        ? nextFamily
        : [nextFamily, nextIndex].join(".") +
            (attrs.length ? `:${attrs.join(":")}` : ""),
    );
  const families = [
    "NO_PIN",
    "gpio",
    ...(hasI2so ? ["i2so"] : []),
    ...uartChannels,
    "void",
  ];
  return (
    <div className="grid grid-cols-[1fr_72px] gap-1.5">
      <select
        value={family}
        onChange={(e) => set(e.target.value)}
        className="rounded-md border border-white/10 bg-[#10141c] px-2 py-2 font-mono text-xs outline-none"
      >
        {families.map((f) => (
          <option key={f}>{f}</option>
        ))}
      </select>
      {family !== "NO_PIN" && family !== "void" ? (
        <select
          value={index}
          onChange={(e) => set(family, e.target.value)}
          className="rounded-md border border-white/10 bg-[#10141c] px-2 py-2 font-mono text-xs outline-none"
        >
          {Array.from({ length: family === "gpio" ? 40 : 32 }, (_, i) => (
            <option key={i}>{i}</option>
          ))}
        </select>
      ) : (
        <div />
      )}
      <select
        value={parts.find((p) => p === "low" || p === "high") ?? "high"}
        onChange={(e) =>
          set(family, index, [
            e.target.value,
            ...parts.slice(1).filter((p) => p !== "low" && p !== "high"),
          ])
        }
        disabled={family === "NO_PIN" || family === "void"}
        className="rounded-md border border-white/10 bg-[#10141c] px-2 py-1.5 text-[10px] outline-none"
      >
        <option>high</option>
        <option>low</option>
      </select>
      <select
        value={parts.find((p) => p === "pu" || p === "pd") ?? ""}
        onChange={(e) =>
          set(family, index, [
            ...parts.slice(1).filter((p) => p !== "pu" && p !== "pd"),
            ...(e.target.value ? [e.target.value] : []),
          ])
        }
        disabled={family === "NO_PIN" || family === "void"}
        className="rounded-md border border-white/10 bg-[#10141c] px-2 py-1.5 text-[10px] outline-none"
      >
        <option value="">No pull</option>
        <option value="pu">Pull up</option>
        <option value="pd">Pull down</option>
      </select>
    </div>
  );
}

function Port({ side }: { side: "left" | "right" | "top" | "bottom" }) {
  return (
    <span
      className={`absolute h-2.5 w-2.5 rounded-full border-2 border-[var(--surface)] bg-current ${side === "left" ? "-left-1.5 top-1/2 -translate-y-1/2" : side === "right" ? "-right-1.5 top-1/2 -translate-y-1/2" : side === "top" ? "-top-1.5 left-1/2 -translate-x-1/2" : "-bottom-1.5 left-1/2 -translate-x-1/2"}`}
    />
  );
}

function MachineHub({
  node,
  nodes,
  selected,
  zoom,
  onSelect,
  onDrag,
  onAdd,
}: {
  node: NodeData;
  nodes: NodeData[];
  selected: boolean;
  zoom: number;
  onSelect: () => void;
  onDrag: (v: { id: string; dx: number; dy: number }) => void;
  onAdd: (kind: NodeKind, title: string) => void;
}) {
  const [openPartition, setOpenPartition] = useState<string | null>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openPartition) return;
    const close = (e: PointerEvent) => {
      if (!hubRef.current?.contains(e.target as Node)) setOpenPartition(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [openPartition]);
  return (
    <div
      ref={hubRef}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
        onDrag({
          id: node.id,
          dx: (e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom,
          dy: (e.clientY - e.currentTarget.getBoundingClientRect().top) / zoom,
        });
      }}
      className={`absolute w-[270px] cursor-grab select-none rounded-xl border bg-[#1b212c] shadow-[0_14px_40px_rgba(0,0,0,.38)] ${selected ? "border-white/35 ring-1 ring-white/10" : "border-white/10"}`}
      style={{ left: node.x, top: node.y }}
    >
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#111722] text-[#aeb9ca]">
          <Cpu size={18} />
        </span>
        <span>
          <span className="block text-sm font-semibold">{node.title}</span>
          <span className="block text-[10px] text-[#6f7c90]">
            {node.fields.board || "FluidNC configuration"}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-2">
        {HUB_PARTITIONS.map((p, i) => {
          const count = nodes.filter(
            (child) => p.kinds.includes(child.kind) && !child.parentId,
          ).length;
          return (
            <div
              key={p.id}
              className={`relative p-3 ${i % 2 === 0 ? "border-r" : ""} ${i < 2 ? "border-b" : ""} border-white/10`}
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-sm"
                  style={{ background: p.color }}
                />
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#aab4c3]">
                  {p.label}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-[#647185]">
                  {count} configured
                </span>
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenPartition((current) =>
                      current === p.id ? null : p.id,
                    );
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-[#111722] text-[#8794a8] hover:border-white/25 hover:text-white"
                  title={`Add ${p.label.toLowerCase()} component`}
                >
                  <Plus size={12} />
                </button>
              </div>
              {openPartition === p.id && (
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  onWheel={(e) => e.stopPropagation()}
                  className={`absolute z-50 mt-2 min-w-44 rounded-md border border-white/10 bg-[#171c26] p-1 shadow-2xl ${i % 2 === 0 ? "left-2" : "right-2"}`}
                >
                  {ROOT_OPTIONS[p.id].map((option) => {
                    const exists = nodes.some(
                      (existing) =>
                        !existing.parentId &&
                        existing.kind === option.kind &&
                        (option.kind !== "io" ||
                          existing.title === option.title),
                    );
                    const disabled = !option.repeatable && exists;
                    return (
                      <button
                        key={option.title}
                        disabled={disabled}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAdd(option.kind, option.title);
                          setOpenPartition(null);
                        }}
                        className={`flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs ${disabled ? "cursor-not-allowed text-[#465164]" : "text-[#bec7d5] hover:bg-white/[.06]"}`}
                      >
                        <Plus
                          size={12}
                          style={{
                            color: disabled ? "#465164" : COLORS[option.kind],
                          }}
                        />
                        <span>{option.title}</span>
                        {disabled && (
                          <span className="ml-auto text-[9px] uppercase tracking-wider">
                            Added
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <span className="absolute -left-1.5 top-[100px] h-2.5 w-2.5 rounded-full border-2 border-[#1b212c] bg-[#dc7659]" />
      <span className="absolute -right-1.5 top-[100px] h-2.5 w-2.5 rounded-full border-2 border-[#1b212c] bg-[#4f8edc]" />
      <span className="absolute left-[63px] -bottom-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#1b212c] bg-[#9c72c2]" />
      <span className="absolute -right-1.5 top-[184px] h-2.5 w-2.5 rounded-full border-2 border-[#1b212c] bg-[#47a986]" />
    </div>
  );
}

function GraphNode({
  node,
  selected,
  zoom,
  onSelect,
  onDrag,
  onAdd,
  inputSide,
}: {
  node: NodeData;
  selected: boolean;
  zoom: number;
  onSelect: () => void;
  onDrag: (v: { id: string; dx: number; dy: number }) => void;
  onAdd: (parent: NodeData, kind: NodeKind, title: string) => void;
  inputSide: "left" | "right" | "top" | "bottom";
}) {
  const [showChildren, setShowChildren] = useState(false);
  const nodeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showChildren) return;
    const close = (e: PointerEvent) => {
      if (!nodeRef.current?.contains(e.target as Node)) setShowChildren(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [showChildren]);
  const children = CHILDREN[node.kind] ?? [];
  return (
    <div
      ref={nodeRef}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
        onDrag({
          id: node.id,
          dx: (e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom,
          dy: (e.clientY - e.currentTarget.getBoundingClientRect().top) / zoom,
        });
      }}
      className={`absolute w-[210px] cursor-grab select-none rounded-lg border bg-[#1b212c] text-left shadow-[0_8px_25px_rgba(0,0,0,.3)] active:cursor-grabbing ${selected ? "border-white/35 ring-1 ring-white/10" : "border-white/10 hover:border-white/20"}`}
      style={{ left: node.x, top: node.y }}
    >
      <Port side={inputSide} />
      <span
        className="block h-1 rounded-t-lg"
        style={{ background: node.color }}
      />
      <span className="flex items-center gap-3 p-3">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-md bg-black/20"
          style={{ color: node.color }}
        >
          {node.kind === "axis" ? (
            <Gauge size={16} />
          ) : node.kind === "control" ? (
            <ShieldCheck size={16} />
          ) : node.kind === "probe" ? (
            <Crosshair size={16} />
          ) : node.kind === "bus" ? (
            <CircuitBoard size={16} />
          ) : node.kind === "stepping" ? (
            <Zap size={16} />
          ) : (
            <Settings2 size={16} />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-[#dce2eb]">
            {node.title}
          </span>
          <span className="block truncate text-[10px] text-[#778498]">
            {node.subtitle}
          </span>
        </span>
        {children.length > 0 && (
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setShowChildren((v) => !v);
            }}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded border border-white/10 bg-[#111722] text-[#8794a8] hover:text-white"
            title="Add child"
          >
            <Plus size={12} />
          </button>
        )}
      </span>
      {showChildren && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          className="absolute left-full top-3 z-30 ml-2 min-w-40 rounded-md border border-white/10 bg-[#171c26] p-1 shadow-2xl"
        >
          {children.map((child) => (
            <button
              key={child.kind}
              onClick={(e) => {
                e.stopPropagation();
                onAdd(node, child.kind, child.title);
                setShowChildren(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs text-[#b9c2d0] hover:bg-white/[.06]"
            >
              <Plus size={12} style={{ color: COLORS[child.kind] }} />
              {child.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConfigStudio({
  content,
  onChange,
}: {
  content: string;
  onChange: (yaml: string) => void;
}) {
  const [nodes, setNodes] = useState<NodeData[]>(() => nodesFromYaml(content));
  const [selected, setSelected] = useState("machine");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);
  const [pendingPlacement, setPendingPlacement] = useState<{
    kind: NodeKind;
    title: string;
    position: { x: number; y: number };
  } | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const panning = useRef<{
    x: number;
    y: number;
    px: number;
    py: number;
  } | null>(null);
  const active = nodes.find((n) => n.id === selected);
  useEffect(() => {
    if (!content.trim()) onChange(contentFromNodes(nodes));
  }, []);
  useEffect(() => {
    if (!palette) return;
    const close = (e: PointerEvent) => {
      if (!searchRef.current?.contains(e.target as Node)) setPalette(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [palette]);
  const hasI2so = nodes.some(
    (n) => n.kind === "bus" && n.fields.type === "i2so",
  );
  const uartChannels = nodes
    .filter(
      (n) => n.kind === "bus" && n.fields.type?.startsWith("uart_channel"),
    )
    .map((n) => n.fields.type);
  const edges = useMemo(
    () =>
      nodes
        .filter((n) => n.id !== "machine")
        .map((n, i) => ({
          from:
            (n.parentId && nodes.find((p) => p.id === n.parentId)) || nodes[0],
          to: n,
          i,
        })),
    [nodes],
  );
  const add = (kind: NodeKind, title: string) => {
    const partition = HUB_PARTITIONS[Math.max(0, hubPartition(kind))];
    const siblings = nodes.filter(
      (node) => !node.parentId && partition.kinds.includes(node.kind),
    );
    const origin =
      PARTITION_ORIGINS[partition.id as keyof typeof PARTITION_ORIGINS];
    setPendingPlacement({
      kind,
      title,
      position: {
        x: origin.x + origin.dx * siblings.length,
        y: origin.y + origin.dy * siblings.length,
      },
    });
  };
  const addChild = (parent: NodeData, kind: NodeKind, title: string) => {
    const id = `${kind}-${Date.now()}`;
    setNodes((ns) => {
      const siblingCount = ns.filter((n) => n.parentId === parent.id).length;
      const usedAxes = new Set(
        ns.filter((n) => n.kind === "axis").map((n) => n.fields.axis),
      );
      const axisLetter =
        ["x", "y", "z", "a", "b", "c"].find((a) => !usedAxes.has(a)) ?? "x";
      const nodeTitle =
        kind === "motor"
          ? `${parent.title.replace(" Axis", "")} Motor ${siblingCount}`
          : kind === "axis"
            ? `${axisLetter.toUpperCase()} Axis`
            : title;
      let root = parent;
      while (root.parentId)
        root = ns.find((node) => node.id === root.parentId) ?? root;
      const direction =
        HUB_PARTITIONS[Math.max(0, hubPartition(root.kind))].direction;
      const position =
        direction === "right"
          ? { x: parent.x + 290, y: parent.y + siblingCount * 105 }
          : direction === "left"
            ? { x: parent.x - 290, y: parent.y + siblingCount * 105 }
            : direction === "bottom"
              ? { x: parent.x + siblingCount * 245, y: parent.y + 125 }
              : { x: parent.x + siblingCount * 245, y: parent.y - 125 };
      return [
        ...ns,
        {
          id,
          kind,
          title: nodeTitle,
          subtitle:
            kind === "motor"
              ? "stepstick · pins not assigned"
              : "New child component",
          x: position.x,
          y: position.y,
          color: COLORS[kind],
          fields: {
            ...defaults(kind),
            ...(kind === "axis" ? { axis: axisLetter } : {}),
          },
          parentId: parent.id,
        },
      ];
    });
    setSelected(id);
  };
  const update = (key: string, value: string) => {
    setNodes((ns) =>
      ns.map((n) =>
        n.id === selected
          ? {
              ...n,
              fields: { ...n.fields, [key]: value },
              subtitle: key === "type" || key === "driver" ? value : n.subtitle,
            }
          : n,
      ),
    );
    onChange(
      contentFromNodes(
        nodes.map((n) =>
          n.id === selected
            ? { ...n, fields: { ...n.fields, [key]: value } }
            : n,
        ),
      ),
    );
  };
  const remove = () => {
    if (!active || active.kind === "machine") return;
    setNodes((ns) => ns.filter((n) => n.id !== selected));
    setSelected("machine");
  };
  const screenToWorld = (e: React.PointerEvent) => ({
    x:
      (e.clientX - e.currentTarget.getBoundingClientRect().left - pan.x) / zoom,
    y: (e.clientY - e.currentTarget.getBoundingClientRect().top - pan.y) / zoom,
  });
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingPlacement(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);
  const commitPlacement = (position: { x: number; y: number }) => {
    if (!pendingPlacement) return;
    const placement = pendingPlacement;
    const id = `${placement.kind}-${Date.now()}`;
    setNodes((ns) => {
      const next = [
        ...ns,
        {
          id,
          kind: placement.kind,
          title: placement.title,
          subtitle:
            placement.kind === "spindle"
              ? "Select spindle type"
              : "New component",
          x: position.x - 105,
          y: position.y - 30,
          color: COLORS[placement.kind],
          fields: defaults(placement.kind),
        },
      ];
      onChange(contentFromNodes(next));
      return next;
    });
    setSelected(id);
    setPendingPlacement(null);
  };
  const handleWheel = (e: React.WheelEvent<HTMLElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const nextZoom = Math.min(
      1.7,
      Math.max(0.35, zoom * (e.deltaY > 0 ? 0.9 : 1.1)),
    );
    if (nextZoom === zoom) return;
    // Keep the world-space point beneath the pointer fixed on screen.
    const world = {
      x: (cursor.x - pan.x) / zoom,
      y: (cursor.y - pan.y) / zoom,
    };
    setPan({
      x: cursor.x - world.x * nextZoom,
      y: cursor.y - world.y * nextZoom,
    });
    setZoom(nextZoom);
  };
  const handleCanvasDown = (e: React.PointerEvent<HTMLElement>) => {
    if (pendingPlacement && e.target === e.currentTarget) {
      e.preventDefault();
      commitPlacement(screenToWorld(e));
      return;
    }
    if (e.target === e.currentTarget) {
      panning.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };
  const handleCanvasMove = (e: React.PointerEvent<HTMLElement>) => {
    if (pendingPlacement) {
      const position = screenToWorld(e);
      setPendingPlacement((current) =>
        current
          ? {
              ...current,
              position: { x: position.x - 105, y: position.y - 30 },
            }
          : null,
      );
      return;
    }
    if (panning.current)
      setPan({
        x: panning.current.px + e.clientX - panning.current.x,
        y: panning.current.py + e.clientY - panning.current.y,
      });
    if (drag.current) {
      const p = screenToWorld(e);
      const d = drag.current;
      setNodes((ns) =>
        ns.map((n) =>
          n.id === d.id ? { ...n, x: p.x - d.dx, y: p.y - d.dy } : n,
        ),
      );
    }
  };
  const handleCanvasUp = () => {
    drag.current = null;
    panning.current = null;
  };
  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[#11151d] text-[#d8dee9]">
      <section
        className="relative min-w-0 flex-1 overflow-hidden"
        onWheel={handleWheel}
        onPointerDown={handleCanvasDown}
        onPointerMove={handleCanvasMove}
        onPointerUp={handleCanvasUp}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage: "radial-gradient(#536071 1px, transparent 1px)",
            backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        />
        <div
          ref={searchRef}
          className="absolute left-3 top-3 z-40 w-64"
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-[#171c26]/95 px-3 py-2 shadow-xl focus-within:border-white/25">
            <Search size={14} className="text-[#778498]" />
            <input
              value={query}
              onFocus={() => setPalette(true)}
              onChange={(e) => {
                setQuery(e.target.value);
                setPalette(true);
              }}
              placeholder="Add node…"
              className="min-w-0 flex-1 bg-transparent text-xs text-[#d5dbe5] outline-none placeholder:text-[#657185]"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  setPalette(false);
                }}
                className="text-[10px] text-[#6f7b8e] hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
          {palette && (
            <div className="mt-1 max-h-80 overflow-auto rounded-md border border-white/10 bg-[#171c26] p-1 shadow-2xl">
              {PALETTE.map((group) => {
                const matches = group.items.filter((item) =>
                  (item.title + item.sub)
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                );
                if (!matches.length) return null;
                return (
                  <div key={group.group}>
                    <div className="px-2.5 pb-1 pt-2 text-[9px] font-bold uppercase tracking-widest text-[#59667a]">
                      {group.group}
                    </div>
                    {matches.map((item) => (
                      <button
                        key={item.title}
                        onClick={() => {
                          add(item.kind, item.title);
                          setPalette(false);
                          setQuery("");
                        }}
                        className="flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left hover:bg-white/[.06]"
                      >
                        <span
                          className="flex h-7 w-7 items-center justify-center rounded border border-white/10 bg-[#202735]"
                          style={{ color: COLORS[item.kind] }}
                        >
                          <Box size={13} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs text-[#cbd2df]">
                            {item.title}
                          </span>
                          <span className="block truncate text-[10px] text-[#687589]">
                            {item.sub}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md border border-white/10 bg-[#171c26]/95 p-1 shadow-xl">
          <button className="rounded bg-white/10 p-1.5 text-white">
            <MousePointer2 size={14} />
          </button>
          <button className="rounded p-1.5 text-[#8995a7] hover:bg-white/5">
            <GitBranch size={14} />
          </button>
          <span className="mx-1 h-5 w-px bg-white/10" />
          <button
            onClick={() => setZoom((z) => Math.max(0.35, z - 0.1))}
            className="p-1.5 text-[#8995a7]"
          >
            <Minus size={14} />
          </button>
          <span className="w-10 text-center text-[10px] text-[#7e8999]">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(1.7, z + 0.1))}
            className="p-1.5 text-[#8995a7]"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            className="p-1.5 text-[#8995a7]"
          >
            <Grid3X3 size={14} />
          </button>
        </div>
        <div
          className="absolute origin-top-left"
          style={{
            transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg className="pointer-events-none absolute left-0 top-0 h-[1400px] w-[1900px] overflow-visible">
            {edges.map((e) => {
              const isHub = e.from.kind === "machine";
              const partition =
                HUB_PARTITIONS[Math.max(0, hubPartition(e.to.kind))];
              const direction = isHub
                ? partition.direction
                : branchDirection(nodes, e.from);
              const hubAnchors = {
                tooling: { x: 0, y: 105 },
                motion: { x: 270, y: 105 },
                hardware: { x: 68, y: 220 },
                safety: { x: 270, y: 189 },
              };
              const source = isHub
                ? {
                    x:
                      e.from.x +
                      hubAnchors[partition.id as keyof typeof hubAnchors].x,
                    y:
                      e.from.y +
                      hubAnchors[partition.id as keyof typeof hubAnchors].y,
                  }
                : direction === "right"
                  ? { x: e.from.x + 210, y: e.from.y + 30 }
                  : direction === "left"
                    ? { x: e.from.x, y: e.from.y + 30 }
                    : { x: e.from.x + 105, y: e.from.y + 60 };
              const target =
                direction === "right"
                  ? { x: e.to.x - 1, y: e.to.y + 30 }
                  : direction === "left"
                    ? { x: e.to.x + 211, y: e.to.y + 30 }
                    : { x: e.to.x + 105, y: e.to.y - 1 };
              const vector =
                direction === "right"
                  ? { x: 90, y: 0 }
                  : direction === "left"
                    ? { x: -90, y: 0 }
                    : { x: 0, y: 90 };
              return (
                <path
                  key={e.to.id}
                  d={`M${source.x},${source.y} C${source.x + vector.x},${source.y + vector.y} ${target.x - vector.x},${target.y - vector.y} ${target.x},${target.y}`}
                  fill="none"
                  stroke={e.to.color}
                  strokeOpacity=".42"
                  strokeWidth="2"
                />
              );
            })}
            {pendingPlacement &&
              (() => {
                const machine = nodes.find((node) => node.kind === "machine");
                if (!machine) return null;
                const partition =
                  HUB_PARTITIONS[
                    Math.max(0, hubPartition(pendingPlacement.kind))
                  ];
                const anchors = {
                  tooling: { x: 0, y: 105 },
                  motion: { x: 270, y: 105 },
                  hardware: { x: 68, y: 220 },
                  safety: { x: 270, y: 189 },
                };
                const anchor = anchors[partition.id as keyof typeof anchors];
                const source = {
                  x: machine.x + anchor.x,
                  y: machine.y + anchor.y,
                };
                const direction = partition.direction;
                const target =
                  direction === "right"
                    ? {
                        x: pendingPlacement.position.x,
                        y: pendingPlacement.position.y + 30,
                      }
                    : direction === "left"
                      ? {
                          x: pendingPlacement.position.x + 210,
                          y: pendingPlacement.position.y + 30,
                        }
                      : {
                          x: pendingPlacement.position.x + 105,
                          y: pendingPlacement.position.y,
                        };
                const vector =
                  direction === "right"
                    ? { x: 90, y: 0 }
                    : direction === "left"
                      ? { x: -90, y: 0 }
                      : { x: 0, y: 90 };
                return (
                  <path
                    d={`M${source.x},${source.y} C${source.x + vector.x},${source.y + vector.y} ${target.x - vector.x},${target.y - vector.y} ${target.x},${target.y}`}
                    fill="none"
                    stroke={COLORS[pendingPlacement.kind]}
                    strokeOpacity=".65"
                    strokeWidth="2"
                    strokeDasharray="5 4"
                  />
                );
              })()}
          </svg>
          {nodes.map((n) =>
            n.kind === "machine" ? (
              <MachineHub
                key={n.id}
                node={n}
                nodes={nodes}
                selected={selected === n.id}
                zoom={zoom}
                onSelect={() => setSelected(n.id)}
                onDrag={(value) => {
                  drag.current = value;
                }}
                onAdd={add}
              />
            ) : (
              <GraphNode
                key={n.id}
                node={n}
                selected={selected === n.id}
                zoom={zoom}
                onSelect={() => setSelected(n.id)}
                onDrag={(value) => {
                  drag.current = value;
                }}
                onAdd={addChild}
                inputSide={
                  (
                    {
                      right: "left",
                      left: "right",
                      top: "bottom",
                      bottom: "top",
                    } as const
                  )[branchDirection(nodes, n)]
                }
              />
            ),
          )}
          {pendingPlacement && (
            <div
              className="pointer-events-none absolute w-[210px] rounded-lg border border-dashed bg-[#1b212c]/80 shadow-2xl"
              style={{
                left: pendingPlacement.position.x,
                top: pendingPlacement.position.y,
                borderColor: COLORS[pendingPlacement.kind],
              }}
            >
              <span
                className="block h-1 rounded-t-lg"
                style={{ background: COLORS[pendingPlacement.kind] }}
              />
              <span className="flex items-center gap-3 p-3">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-black/20"
                  style={{ color: COLORS[pendingPlacement.kind] }}
                >
                  <Plus size={16} />
                </span>
                <span>
                  <span className="block text-xs font-semibold">
                    {pendingPlacement.title}
                  </span>
                  <span className="block text-[10px] text-[#778498]">
                    Click or tap to place
                  </span>
                </span>
              </span>
            </div>
          )}
        </div>
        {pendingPlacement ? (
          <div
            className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-md border px-3 py-2 text-xs shadow-xl"
            style={{
              borderColor: COLORS[pendingPlacement.kind],
              background: "#171c26",
            }}
          >
            <span>
              Click or tap the canvas to place <b>{pendingPlacement.title}</b>
            </span>
            <button
              onClick={() => setPendingPlacement(null)}
              className="rounded border border-white/10 px-2 py-1 text-[#9aa6b8] hover:text-white"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="absolute bottom-3 left-3 rounded border border-white/10 bg-[#171c26]/90 px-2.5 py-1.5 text-[10px] text-[#69768a]">
            Drag canvas to pan · Scroll to zoom · Select a node to configure
          </div>
        )}
      </section>
      <aside className="z-20 w-[320px] shrink-0 border-l border-white/10 bg-[#171c26]">
        {active ? (
          <>
            <div className="flex items-center gap-3 border-b border-white/10 p-4">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-md bg-black/20"
                style={{ color: active.color }}
              >
                <SlidersHorizontal size={17} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">
                  {active.title}
                </span>
                <span className="block text-[10px] uppercase tracking-widest text-[#6f7b8e]">
                  {active.kind} node
                </span>
              </span>
              {active.kind !== "machine" && (
                <button
                  onClick={remove}
                  className="ml-auto rounded p-1.5 text-[#7c6370] hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="h-[calc(100%-68px)] overflow-auto p-4">
              <label className="mb-5 block">
                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-[#707d90]">
                  Node label
                </span>
                <input
                  value={active.title}
                  onChange={(e) =>
                    setNodes((ns) =>
                      ns.map((n) =>
                        n.id === active.id
                          ? { ...n, title: e.target.value }
                          : n,
                      ),
                    )
                  }
                  className="w-full rounded-md border border-white/10 bg-[#10141c] px-2.5 py-2 text-xs outline-none"
                />
              </label>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#707d90]">
                Properties
              </div>
              <div className="space-y-3">
                {FIELDS[active.kind].map((f) => (
                  <label key={f.key} className="block">
                    <span className="mb-1.5 flex text-[11px] text-[#a9b3c2]">
                      <span>{f.label}</span>
                      {f.unit && (
                        <span className="ml-auto text-[#5e6a7c]">{f.unit}</span>
                      )}
                    </span>
                    {f.type === "pin" ? (
                      <PinEditor
                        value={active.fields[f.key] ?? "NO_PIN"}
                        onChange={(v) => update(f.key, v)}
                        hasI2so={hasI2so}
                        uartChannels={uartChannels}
                      />
                    ) : f.type === "boolean" ? (
                      <button
                        onClick={() =>
                          update(
                            f.key,
                            active.fields[f.key] === "true" ? "false" : "true",
                          )
                        }
                        className={`flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-xs ${active.fields[f.key] === "true" ? "border-[#548f78]/50 bg-[#29483d]/40 text-[#83c5aa]" : "border-white/10 bg-[#10141c] text-[#748094]"}`}
                      >
                        <span>
                          {active.fields[f.key] === "true"
                            ? "Enabled"
                            : "Disabled"}
                        </span>
                        <span
                          className={`h-4 w-7 rounded-full p-0.5 ${active.fields[f.key] === "true" ? "bg-[#559c7e]" : "bg-[#384252]"}`}
                        >
                          <span
                            className={`block h-3 w-3 rounded-full bg-white transition-transform ${active.fields[f.key] === "true" ? "translate-x-3" : ""}`}
                          />
                        </span>
                      </button>
                    ) : f.options ? (
                      <select
                        value={active.fields[f.key]}
                        onChange={(e) => update(f.key, e.target.value)}
                        className="w-full rounded-md border border-white/10 bg-[#10141c] px-2.5 py-2 text-xs outline-none"
                      >
                        {f.options.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={f.type === "number" ? "number" : "text"}
                        value={active.fields[f.key] ?? ""}
                        onChange={(e) => update(f.key, e.target.value)}
                        className="w-full rounded-md border border-white/10 bg-[#10141c] px-2.5 py-2 font-mono text-xs outline-none"
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="p-5 text-xs text-[#758195]">
            Select a node to inspect it.
          </div>
        )}
      </aside>
    </div>
  );
}

function contentFromNodes(nodes: NodeData[]) {
  const out: string[] = ["# Generated by FluidUI Config Studio"];
  const machine = nodes.find((n) => n.kind === "machine");
  if (machine) {
    out.push(
      `name: "${machine.fields.name}"`,
      `board: "${machine.fields.board}"`,
    );
    if (machine.fields.meta) out.push(`meta: "${machine.fields.meta}"`);
  }
  const stepping = nodes.find((n) => n.kind === "stepping");
  if (stepping) {
    out.push(
      "",
      "stepping:",
      ...FIELDS.stepping
        .filter((f) => stepping.fields[f.key])
        .map((f) => `  ${f.key}: ${stepping.fields[f.key]}`),
    );
  }
  const axes = nodes.filter((n) => n.kind === "axis");
  if (axes.length) {
    out.push("", "axes:");
    for (const a of axes) {
      out.push(`  ${a.fields.axis}:`);
      for (const f of FIELDS.axis.filter(
        (f) =>
          !f.key.startsWith("motor") &&
          ![
            "axis",
            "homing_cycle",
            "homing_positive",
            "homing_mpos_mm",
          ].includes(f.key) &&
          a.fields[f.key],
      ))
        out.push(`    ${f.key}: ${a.fields[f.key]}`);
      if (a.fields.homing_cycle) {
        out.push(
          "    homing:",
          `      cycle: ${a.fields.homing_cycle}`,
          `      positive_direction: ${a.fields.homing_positive}`,
          `      mpos_mm: ${a.fields.homing_mpos_mm || 0}`,
        );
      }
      const motors = nodes.filter(
        (n) => n.kind === "motor" && n.parentId === a.id,
      );
      motors.forEach((motor, index) => {
        out.push(`    motor${index}:`);
        for (const key of [
          "limit_neg_pin",
          "limit_pos_pin",
          "limit_all_pin",
          "hard_limits",
          "pulloff_mm",
        ]) {
          const value = motor.fields[key];
          if (value && value !== "NO_PIN" && value !== "false")
            out.push(`      ${key}: ${value}`);
        }
        const driver = motor.fields.driver || "stepstick";
        out.push(`      ${driver}:`);
        for (const f of FIELDS.motor.filter(
          (f) =>
            ![
              "driver",
              "limit_neg_pin",
              "limit_pos_pin",
              "limit_all_pin",
              "hard_limits",
              "pulloff_mm",
            ].includes(f.key),
        )) {
          const value = motor.fields[f.key];
          if (value && value !== "NO_PIN" && value !== "false")
            out.push(`        ${f.key}: ${value}`);
        }
        for (const key of ["step_pin", "direction_pin"])
          if (!motor.fields[key] || motor.fields[key] === "NO_PIN")
            out.push(`        ${key}: NO_PIN`);
      });
    }
  }
  const simple: Partial<Record<NodeKind, string>> = {
    control: "control",
    probe: "probe",
    coolant: "coolant",
    macro: "macros",
    parking: "parking",
    display: "oled",
    atc: "atc_manual",
    storage: "sdcard",
  };
  for (const n of nodes) {
    const section = simple[n.kind];
    if (section) {
      out.push(
        "",
        `${section}:`,
        ...FIELDS[n.kind]
          .filter((f) => n.fields[f.key] && n.fields[f.key] !== "false")
          .map((f) => `  ${f.key}: ${n.fields[f.key]}`),
      );
    }
    if (n.kind === "bus") {
      const type = n.fields.type || "uart1";
      out.push(
        "",
        `${type}:`,
        ...FIELDS.bus
          .filter(
            (f) =>
              f.key !== "type" &&
              n.fields[f.key] &&
              n.fields[f.key] !== "NO_PIN",
          )
          .map((f) => `  ${f.key}: ${n.fields[f.key]}`),
      );
    }
    if (n.kind === "spindle") {
      const type = n.fields.type || "PWM";
      out.push(
        "",
        `${type}:`,
        ...FIELDS.spindle
          .filter(
            (f) =>
              f.key !== "type" &&
              n.fields[f.key] &&
              n.fields[f.key] !== "NO_PIN",
          )
          .map((f) => `  ${f.key}: ${n.fields[f.key]}`),
      );
    }
    if (n.kind === "io") {
      out.push(
        "",
        `${n.title.toLowerCase().includes("input") ? "user_inputs" : "user_outputs"}:`,
        ...FIELDS.io
          .filter((f) => n.fields[f.key] && n.fields[f.key] !== "NO_PIN")
          .map((f) => `  ${f.key}: ${n.fields[f.key]}`),
      );
    }
  }
  let yaml = out.join("\n") + "\n";
  const axesGroup = nodes.find((n) => n.kind === "axes");
  const sharedDisable = axesGroup?.fields.shared_stepper_disable_pin;
  if (sharedDisable && sharedDisable !== "NO_PIN")
    yaml = yaml.replace(
      "axes:\n",
      `axes:\n  shared_stepper_disable_pin: ${sharedDisable}\n`,
    );
  return yaml;
}
