---
name: home-automation
description: Control Home Assistant devices via MCP. Turn lights on/off, set thermostats, check sensor states, and trigger automations.
triggers: ["lights", "thermostat", "home assistant", "smart home", "turn on", "turn off"]
version: 1
success_count: 0
fail_count: 0
created_at: 2026-07-13T22:00:00Z
updated_at: 2026-07-13T22:00:00Z
---

# Home Automation via MCP

## Setup

1. Connect to the Home Assistant MCP server via `this.mcp.connect(url)` in the agent's `onStart()`.
2. The MCP server exposes tools: `call_service`, `get_state`, `set_state`, `trigger_automation`.
3. Use entity IDs like `light.living_room`, `climate.thermostat`, `sensor.temperature`.

## Common Commands

- Turn on a light: `call_service` with `domain: "light"`, `service: "turn_on"`, `entity_id: "light.living_room"`
- Set thermostat: `call_service` with `domain: "climate"`, `service: "set_temperature"`, `entity_id: "climate.thermostat"`, `temperature: 72`
- Check sensor: `get_state` with `entity_id: "sensor.temperature"`

## Safety

- Never call `call_service` with `domain: "automation"` and `service: "trigger"` without user approval.
- Always confirm temperature changes before executing.
- Use `needsApproval: async () => true` on destructive service calls.