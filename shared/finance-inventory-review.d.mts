export function validateInventoryPacket(packet: any): any
export function inventoryCodes(packet: any): string[]
export function inventoryDecision(body: any, packet: any): {status: string, productName: string, note: string}
export function inventoryCalculation(packet: any, amount: number): {total: number | null, difference: number | null}
