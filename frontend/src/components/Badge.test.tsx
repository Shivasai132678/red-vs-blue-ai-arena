import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Badge } from './Badge'
it('labels check failure independently from allowed', () => {
  render(<Badge value="check_failed" />)
  expect(screen.getByText('Check failed')).toBeInTheDocument()
  expect(screen.queryByText('Allowed')).not.toBeInTheDocument()
})
it('identifies local provenance', () => {
  render(<Badge value="local" />)
  expect(screen.getByText('Local rule')).toBeInTheDocument()
})
