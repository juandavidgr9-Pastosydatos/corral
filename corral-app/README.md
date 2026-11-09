# Corral - Pastos & Datos

App instalable (PWA) para registrar datos en corral sin internet. Los datos viven solo en el celular (IndexedDB); el respaldo es el Excel que descarga la app.

- Entrada: Excel de Software Ganadero SG o Excel de avance de esta app (hoja oculta `_respaldo`).
- Pestañas: Inventario, Palpar, Pesar, Destete, Listado, Archivo.
- Reglas editables al inicio de `app.js` (`CFG`): HL 80-350 kg, entore >295 kg, destete 80-190 kg, GMD -200 a 900 g/día, gestación a revisar desde 300 días.
- Al cambiar archivos, subir el número de `CACHE` en `sw.js` para que los celulares reciban la actualización.

## Versión 2.0.0
- Se adapta a tablet (Huawei MatePad 2000x1200 y similares), en vertical y horizontal. En horizontal muestra dos columnas.
- Inventario: reloj de progreso con filtros por lote, categoría, sexo y estado reproductivo (datos con que se cargó el Excel). Al tocarlo muestra los que faltan y los que ya pasaron.
- Listado → Resumen de movimientos: animales por lote de origen → lote de destino. También sale en la hoja "Resumen movimientos" del Excel.
