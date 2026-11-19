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

## Versión 4.0.2
- Pesar: también se pesan machos de levante (ML), con rango de 80 a 500 kg. El botón ENTORE sigue solo para hembras de levante.

## Versión 5.0.0
- Destete en tres pasos: la decisión (destetar, finca o venta) se guarda sin peso ni número nuevo; luego se completan buscando la vaca o la cría. Panel "Destetes pendientes" (sin peso / sin número nuevo).
- La vaca destetada pasa a SECADO (antes DESTETE). La cría que queda en finca pasa a DESTETE y la de venta a VENTA. Al palpar la vaca sale el aviso "SEPARAR → SECADO".
- Movimientos → Programar movimientos: filtrar vacas preñadas de un lote por días de gestación y programar el lote destino. En Palpar sale "MOVER A ..." con el lote ya seleccionado; solo se mueve al guardar y se puede cambiar.
- Excel: hoja "Mov. programados" y columna "Programado" en el resumen.

## Versión 5.1.0
- Al subir el Excel de SG se pide la fecha en que se generó (DD/MM/AAAA). Con ella se calculan gestación, días abiertos y edades. Se puede corregir en Archivo. El archivo de avance conserva esa fecha al pasar a otro equipo.
- Destete: la vaca ya no queda inventariada (se inventaría al palparla); el interruptor de Destete es de la cría. Sigue el movimiento a SECADO y su aviso.

## Versión 5.2.0
- Foto opcional por animal (apartado plegable "Foto (opcional)" en Inventario, Palpar, Pesar y Destete; en Destete es de la cría). Se puede cambiar o borrar.
- Las fotos se reducen (~150 KB) y se guardan solo en el equipo. El Excel trae la columna "Foto" con el nombre del archivo; las fotos se descargan aparte en Archivo → "Descargar fotos" (.zip con finca_número_fecha.jpg).
- Al cargar otro Excel se avisa y se borran las fotos del equipo.

## Versión 5.3.0
- Al mover de lote una vaca con cría sin destetar (Inventario, Palpar o movimiento programado), la cría se mueve con ella al mismo lote. Aviso en pantalla antes de guardar; Deshacer revierte ambas. Las crías ya destetadas no se mueven.
- sw.js: al actualizar solo borra sus propias copias (corral-), para convivir con otras apps del mismo dominio.

## Versión 5.4.0
- Movimiento en los dos sentidos: si se mueve una cría sin destetar, también se mueven su madre y sus hermanos sin destetar. Destete no cambia: tiene su propio movimiento.
- Enviar por WhatsApp en Android y tablet: guarda el Excel en Descargas y abre WhatsApp con los pasos para adjuntarlo como Documento (Android no permite compartir .xlsx desde una app web). En iPhone sigue el menú de compartir.
