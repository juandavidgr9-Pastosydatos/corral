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

## Versión 3.0.0
- Aviso "No ha guardado" al cambiar de pestaña, tocar "Otro animal" o abrir otro animal con datos sin guardar (Guardar ahora / Volver / Salir sin guardar).
- Mover rápido: botones con los últimos lotes de destino (primero los usados desde el mismo lote).
- La pestaña Listado se llama Movimientos y abre en el resumen. El resumen muestra cuántos animales quedan en el lote de origen (también en el Excel).

## Versión 4.0.0
- Inventario: tabla "Inventario por lote" (filas = lotes, columnas = estado animal EA, total). Botones Inicial (como se cargó el Excel) y Actual (con movimientos, entores y destetes; lo que cambió va en azul y el total muestra ± frente al inicial).
- En tablet horizontal la tabla aparece debajo del reloj; en celular y tablet vertical se abre con el botón "Inventario por lote y estado".
- El Excel trae las hojas "Inv. lote inicial" e "Inv. lote actual".

## Versión 4.0.1
- Actualización automática: al abrir la app (o volver a ella) con internet busca la versión nueva y se recarga sola. Si hay datos sin guardar, avisa en vez de recargar.
- Los archivos de la app se descargan siempre del servidor al actualizar (evita quedarse con archivos viejos).
