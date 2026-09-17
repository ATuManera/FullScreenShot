// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

use crate::error::CoreError;

/// Sink for streaming, row-by-row image output. Implemented by P1's PNG
/// writer and the streaming compositor so full-page composition never
/// needs to hold the entire stitched bitmap in memory at once.
pub trait RowSink {
    fn write_row(&mut self, row: &[u8]) -> Result<(), CoreError>;
}

pub type CompositeError = CoreError;

#[cfg(test)]
mod tests {
    use super::*;

    struct CountingSink {
        rows_written: usize,
    }

    impl RowSink for CountingSink {
        fn write_row(&mut self, _row: &[u8]) -> Result<(), CoreError> {
            self.rows_written += 1;
            Ok(())
        }
    }

    #[test]
    fn row_sink_trait_is_implementable_and_callable() {
        let mut sink = CountingSink { rows_written: 0 };
        sink.write_row(&[0, 0, 0, 255]).unwrap();
        sink.write_row(&[255, 255, 255, 255]).unwrap();
        assert_eq!(sink.rows_written, 2);
    }
}
