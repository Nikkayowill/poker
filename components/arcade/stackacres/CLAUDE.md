# StackAcres

Loads when working under this directory. Before any StackAcres design, economy, progression or UX
decision, read `docs/stackacres-direction.md`. It is the product direction for the whole farm game.

The short version:

- StackAcres is a full 2D farming game sitting on a Gold investment layer inside StackChips. It is
  both a big Gold sink and a capped passive Gold source.
- Gold sinks are investments (land, buildings, machines, storage, automation). Never charge Gold per
  basic action like watering, feeding or using a machine.
- Farm actions are optimistic and instant. Tap, render, then reconcile with the server.
- When priorities conflict: feel, then fun, then progression, then economy, then StackChips
  integration, then technical simplicity.
- For every feature, say where Gold enters and where it leaves before writing code.
