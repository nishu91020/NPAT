import React from 'react';

interface RoomStatusMessageProps {
  icon: React.ReactNode;
  title: string;
  text: string;
  className?: string;
}

export const RoomStatusMessage: React.FC<RoomStatusMessageProps> = ({
  icon,
  title,
  text,
  className = 'room__status',
}) => (
  <div className={className}>
    {icon}
    <p className="room__status-title">{title}</p>
    <p className="room__status-text">{text}</p>
  </div>
);
