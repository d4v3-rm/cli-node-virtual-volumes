import type { ReactNode } from 'react';

import { Box, Text } from 'ink';

interface PaneProps {
  title: string;
  active?: boolean;
  children: ReactNode;
  footer?: string;
}

export const Pane = ({
  title,
  active = false,
  children,
  footer,
}: PaneProps): ReactNode => (
  <Box flexDirection="column" paddingX={1} paddingY={1} width="100%">
    <Text color={active ? 'black' : 'white'} backgroundColor={active ? 'cyan' : 'gray'}>
      {' '}
      {title}
      {' '}
    </Text>
    <Box marginTop={1} flexDirection="column">
      {children}
    </Box>
    {footer ? (
      <Box marginTop={1}>
        <Text color="gray">{footer}</Text>
      </Box>
    ) : null}
  </Box>
);
