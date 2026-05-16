## Approach
- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read unless the file may have changed.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct.
- User instructions always override this file.

## Universal Investor Cut (migración 010)

Cada paquete manufacturado vendido (a cualquier cliente, incluso si NO es
Borbón) genera dos asignaciones fijas, más una tercera cuando la venta no
es a Borbón:

| Concepto                      | Monto / pkg            | Destino                                |
|-------------------------------|------------------------|----------------------------------------|
| Amortización deuda            | RD$100                 | Reduce `investor.total_debt` al instante|
| Beneficio físico a Borbón     | RD$100                 | Acumulado en `investor_payouts`        |
| Margen reventa (no-Borbón)    | `max(unitPrice−735, 0)`| Acumulado en `investor_payouts`        |

Para ventas a Borbón el `investor_payouts` no se crea (Borbón ya recibió
el beneficio como descuento en el precio).

Las constantes viven en `js/api.js`:
```
export const INVESTOR_AMORTIZATION_PER_PKG = 100;
export const INVESTOR_BENEFIT_PER_PKG      = 100;
export const WHOLESALE_PRICE_PER_PKG       = 735;
```
y se reexportan/usan también en `js/modules/sales.js`.

El sync se ejecuta automáticamente dentro de `SalesAPI` (create / update /
remove / createWithInventoryDebit / confirmWithInventoryDebit) a través
del helper `_syncSaleInvestorState`. Los módulos cliente NO deben emitir
amortizaciones ni filas de payout manualmente.

Módulo UI: **Entregas a Borbón** (`js/modules/investor-payouts.js`,
ruta `#investor-payouts`). Permite marcar entregas como `delivered` /
`pending`. El cambio físico de la entrega NO modifica `total_debt` — solo
la amortización lo hace, y eso pasa al crear la venta.
